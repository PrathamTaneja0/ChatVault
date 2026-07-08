import { describe, it, expect, afterEach, vi } from 'vitest';
import type { Conversation, Message } from '../../src/core/schema';
import {
  collectImageAttachmentsFromElement,
  findLiveImageElement,
  fitDimensions,
  hydrateImageAttachments,
  isEmbeddableDataUrl,
} from '../../src/core/images';
import { renderConversationHtml } from '../../src/core/render';
import { buildExportJson } from '../../src/core/export';
import { DEFAULT_EXPORT_OPTIONS } from '../../src/core/schema';

function conversationWith(messages: Message[]): Conversation {
  return {
    metadata: {
      platform: 'test',
      platformLabel: 'Test',
      url: 'https://example.com',
      exportedAt: new Date().toISOString(),
      messageCount: messages.length,
    },
    messages,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('fitDimensions', () => {
  it('keeps small images unchanged', () => {
    expect(fitDimensions(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('scales down oversized images proportionally', () => {
    expect(fitDimensions(2800, 1400)).toEqual({ width: 1400, height: 700 });
    expect(fitDimensions(1400, 2800)).toEqual({ width: 700, height: 1400 });
  });
});

describe('isEmbeddableDataUrl', () => {
  it('accepts png and jpeg data urls only', () => {
    expect(isEmbeddableDataUrl('data:image/png;base64,AAAA')).toBe(true);
    expect(isEmbeddableDataUrl('data:image/jpeg;base64,AAAA')).toBe(true);
    expect(isEmbeddableDataUrl('data:image/webp;base64,AAAA')).toBe(false);
    expect(isEmbeddableDataUrl('https://example.com/a.png')).toBe(false);
  });
});

describe('collectImageAttachmentsFromElement', () => {
  it('collects content images and skips avatars, icons, and buttons', () => {
    document.body.innerHTML = `
      <div id="msg">
        <div class="avatar-wrap"><img src="https://cdn.example.com/avatar.png" width="40" height="40"></div>
        <img src="https://cdn.example.com/icon.svg" width="16" height="16">
        <button><img src="https://cdn.example.com/btn.png" width="200" height="200"></button>
        <img src="https://cdn.example.com/photo.png" width="400" height="300" alt="Site photo">
      </div>
    `;
    const el = document.getElementById('msg')!;
    const attachments = collectImageAttachmentsFromElement(el, 'assistant', 'test', 0);
    expect(attachments).toHaveLength(1);
    expect(attachments[0].kind).toBe('image');
    expect(attachments[0].sourceUrl).toBe('https://cdn.example.com/photo.png');
    expect(attachments[0].name).toBe('Site photo');
  });

  it('dedupes repeated sources', () => {
    document.body.innerHTML = `
      <div id="msg">
        <img src="https://cdn.example.com/photo.png" width="400" height="300">
        <img src="https://cdn.example.com/photo.png" width="400" height="300">
      </div>
    `;
    const attachments = collectImageAttachmentsFromElement(
      document.getElementById('msg')!,
      'user',
      'test',
      0,
    );
    expect(attachments).toHaveLength(1);
  });
});

describe('findLiveImageElement', () => {
  it('finds the rendered img by source url', () => {
    document.body.innerHTML = `<img src="https://cdn.example.com/a.png"><img src="https://cdn.example.com/b.png">`;
    const found = findLiveImageElement(document, 'https://cdn.example.com/b.png');
    expect(found?.src).toBe('https://cdn.example.com/b.png');
    expect(findLiveImageElement(document, 'https://cdn.example.com/missing.png')).toBeNull();
    expect(findLiveImageElement(document, undefined)).toBeNull();
  });
});

describe('hydrateImageAttachments', () => {
  it('leaves attachments un-embedded when every strategy fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('network down'))));
    const conversation = conversationWith([
      {
        id: 'm1',
        role: 'user',
        content: 'look at this',
        attachments: [
          { id: 'a1', kind: 'image', content: 'Image', sourceUrl: 'https://cdn.example.com/x.png' },
        ],
      },
    ]);

    await hydrateImageAttachments(conversation, undefined, () => null);
    expect(conversation.messages[0].attachments![0].dataUrl).toBeUndefined();
    expect(conversation.messages[0].attachments![0].sourceUrl).toBe('https://cdn.example.com/x.png');
  });

  it('skips attachments that already have a data url', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const conversation = conversationWith([
      {
        id: 'm1',
        role: 'user',
        content: 'x',
        attachments: [
          {
            id: 'a1',
            kind: 'image',
            content: 'Image',
            dataUrl: 'data:image/png;base64,AAAA',
            sourceUrl: 'https://cdn.example.com/x.png',
          },
        ],
      },
    ]);

    await hydrateImageAttachments(conversation);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('render + export with images', () => {
  const imageMessage: Message = {
    id: 'm1',
    role: 'assistant',
    content: 'Here is the chart.',
    attachments: [
      {
        id: 'a1',
        kind: 'image',
        name: 'Sales chart',
        content: 'Sales chart',
        dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
        width: 400,
        height: 300,
      },
    ],
  };

  it('embeds hydrated images in the rendered HTML', () => {
    const html = renderConversationHtml(conversationWith([imageMessage]), DEFAULT_EXPORT_OPTIONS);
    expect(html).toContain('data:image/png;base64,iVBORw0KGgo=');
    expect(html).toContain('width="400"');
    expect(html).toContain('Sales chart');
  });

  it('renders a note for images that could not be embedded', () => {
    const message: Message = {
      id: 'm2',
      role: 'user',
      content: 'photo attached',
      attachments: [
        { id: 'a2', kind: 'image', name: 'photo.png', content: 'photo.png', sourceUrl: 'https://x/y.png' },
      ],
    };
    const html = renderConversationHtml(conversationWith([message]), DEFAULT_EXPORT_OPTIONS);
    expect(html).toContain('could not be embedded');
  });

  it('omits embedded image bytes from JSON export', () => {
    const json = buildExportJson(conversationWith([imageMessage]), DEFAULT_EXPORT_OPTIONS);
    const parsed = JSON.parse(json);
    expect(parsed.messages[0].attachments[0].dataUrl).toBe('[embedded image 400x300]');
    expect(json).not.toContain('iVBORw0KGgo=');
  });
});
