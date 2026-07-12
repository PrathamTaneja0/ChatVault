import { describe, it, expect } from 'vitest';
import {
  assetPointerToFileId,
  getChatGptConversationId,
  mapChatGptApiConversation,
  walkActiveBranch,
  type ChatGptApiConversation,
} from '../../src/sources/chatgpt-api';

const PAGE_URL = 'https://chatgpt.com/c/aaaa1111-2222-3333-4444-555566667777';

const BRANCHED_PAYLOAD: ChatGptApiConversation = {
  title: 'Japan trip planning',
  current_node: 'n4',
  mapping: {
    root: { id: 'root', parent: null, children: ['n1'], message: null },
    n1: {
      id: 'n1',
      parent: 'root',
      children: ['n2'],
      message: { id: 'm1', author: { role: 'system' }, content: { content_type: 'text', parts: [''] } },
    },
    n2: {
      id: 'n2',
      parent: 'n1',
      children: ['n3-old', 'n3'],
      message: {
        id: 'm2',
        author: { role: 'user' },
        create_time: 1_720_000_000,
        content: { content_type: 'text', parts: ['Plan a two week trip to Japan'] },
      },
    },
    'n3-old': {
      id: 'n3-old',
      parent: 'n2',
      children: [],
      message: {
        id: 'm3-old',
        author: { role: 'assistant' },
        content: { content_type: 'text', parts: ['This answer was regenerated away'] },
      },
    },
    n3: {
      id: 'n3',
      parent: 'n2',
      children: ['n4'],
      message: {
        id: 'm3',
        author: { role: 'assistant' },
        content: {
          content_type: 'thoughts',
          thoughts: [{ summary: 'Considering seasons', content: 'Spring is ideal for this trip.' }],
        },
      },
    },
    n4: {
      id: 'n4',
      parent: 'n3',
      children: [],
      message: {
        id: 'm4',
        author: { role: 'assistant' },
        create_time: 1_720_000_060,
        content: { content_type: 'text', parts: ['Here is your two week itinerary.'] },
        metadata: { model_slug: 'gpt-5' },
      },
    },
  },
};

describe('getChatGptConversationId', () => {
  it('extracts the conversation id from /c/ paths', () => {
    expect(getChatGptConversationId('/c/aaaa1111-2222-3333-4444-555566667777')).toBe(
      'aaaa1111-2222-3333-4444-555566667777',
    );
    expect(getChatGptConversationId('/g/g-abc/c/aaaa1111-2222-3333-4444-555566667777')).toBe(
      'aaaa1111-2222-3333-4444-555566667777',
    );
  });

  it('returns undefined on the home page', () => {
    expect(getChatGptConversationId('/')).toBeUndefined();
  });
});

describe('walkActiveBranch', () => {
  it('follows parent links from current_node, excluding abandoned branches', () => {
    const branch = walkActiveBranch(BRANCHED_PAYLOAD.mapping!, 'n4');
    const ids = branch.map((m) => m.id);
    expect(ids).toEqual(['m1', 'm2', 'm3', 'm4']);
    expect(ids).not.toContain('m3-old');
  });

  it('falls back to the latest leaf when current_node is missing', () => {
    const branch = walkActiveBranch(BRANCHED_PAYLOAD.mapping!, undefined);
    expect(branch.map((m) => m.id)).toContain('m4');
    expect(branch.map((m) => m.id)).not.toContain('m3-old');
  });
});

describe('mapChatGptApiConversation', () => {
  it('maps the active branch with thoughts as reasoning messages', () => {
    const conversation = mapChatGptApiConversation(BRANCHED_PAYLOAD, PAGE_URL)!;
    expect(conversation.messages.map((m) => m.role)).toEqual(['user', 'reasoning', 'assistant']);
    expect(conversation.messages[1].content).toContain('Spring is ideal');
    expect(conversation.messages[2].content).toBe('Here is your two week itinerary.');
    expect(conversation.metadata.model).toBe('gpt-5');
    expect(conversation.metadata.source).toBe('api');
    expect(conversation.metadata.title).toBe('Japan trip planning');
  });

  it('maps multimodal image parts to image attachments with file placeholders', () => {
    const payload: ChatGptApiConversation = {
      current_node: 'n2',
      mapping: {
        n1: {
          id: 'n1',
          parent: null,
          children: ['n2'],
          message: {
            id: 'm1',
            author: { role: 'user' },
            content: {
              content_type: 'multimodal_text',
              parts: [
                { content_type: 'image_asset_pointer', asset_pointer: 'file-service://file-AbC123', width: 800, height: 600 },
                'What is in this picture?',
              ],
            },
          },
        },
        n2: {
          id: 'n2',
          parent: 'n1',
          children: [],
          message: {
            id: 'm2',
            author: { role: 'assistant' },
            content: { content_type: 'text', parts: ['It shows a drill.'] },
          },
        },
      },
    };
    const conversation = mapChatGptApiConversation(payload, PAGE_URL)!;
    const images = conversation.messages[0].attachments?.filter((a) => a.kind === 'image');
    expect(images).toHaveLength(1);
    expect(images![0].sourceUrl).toBe('chatgpt-file:file-AbC123');
    expect(conversation.messages[0].content).toBe('What is in this picture?');
  });

  it('keeps tool messages that carry generated images, skips other tool/system messages', () => {
    const payload: ChatGptApiConversation = {
      current_node: 'n3',
      mapping: {
        n1: {
          id: 'n1',
          parent: null,
          children: ['n2'],
          message: {
            id: 'm1',
            author: { role: 'user' },
            content: { content_type: 'text', parts: ['Draw a cat'] },
          },
        },
        n2: {
          id: 'n2',
          parent: 'n1',
          children: ['n3'],
          message: {
            id: 'm2',
            author: { role: 'tool', name: 'dalle.text2im' },
            content: {
              content_type: 'multimodal_text',
              parts: [{ content_type: 'image_asset_pointer', asset_pointer: 'file-service://file-Cat999' }],
            },
          },
        },
        n3: {
          id: 'n3',
          parent: 'n2',
          children: [],
          message: {
            id: 'm3',
            author: { role: 'tool', name: 'browser' },
            content: { content_type: 'text', parts: ['tool noise'] },
          },
        },
      },
    };
    const conversation = mapChatGptApiConversation(payload, PAGE_URL)!;
    expect(conversation.messages).toHaveLength(2);
    const imageMsg = conversation.messages[1];
    expect(imageMsg.role).toBe('assistant');
    expect(imageMsg.attachments?.[0].sourceUrl).toBe('chatgpt-file:file-Cat999');
  });

  it('skips hidden messages and messages addressed to tools', () => {
    const payload: ChatGptApiConversation = {
      current_node: 'n3',
      mapping: {
        n1: {
          id: 'n1',
          parent: null,
          children: ['n2'],
          message: {
            id: 'm1',
            author: { role: 'user' },
            content: { content_type: 'text', parts: ['Question'] },
            metadata: { is_visually_hidden_from_conversation: true },
          },
        },
        n2: {
          id: 'n2',
          parent: 'n1',
          children: ['n3'],
          message: {
            id: 'm2',
            author: { role: 'assistant' },
            recipient: 'browser',
            content: { content_type: 'text', parts: ['search("weather")'] },
          },
        },
        n3: {
          id: 'n3',
          parent: 'n2',
          children: [],
          message: {
            id: 'm3',
            author: { role: 'assistant' },
            content: { content_type: 'text', parts: ['Visible answer'] },
          },
        },
      },
    };
    const conversation = mapChatGptApiConversation(payload, PAGE_URL)!;
    expect(conversation.messages).toHaveLength(1);
    expect(conversation.messages[0].content).toBe('Visible answer');
  });

  it('returns null for empty payloads', () => {
    expect(mapChatGptApiConversation({}, PAGE_URL)).toBeNull();
    expect(mapChatGptApiConversation({ mapping: {} }, PAGE_URL)).toBeNull();
  });
});

describe('assetPointerToFileId', () => {
  it('extracts file ids from asset pointers', () => {
    expect(assetPointerToFileId('file-service://file-AbC123')).toBe('file-AbC123');
    expect(assetPointerToFileId('sediment://file_0000abcd')).toBe('file_0000abcd');
    expect(assetPointerToFileId('nonsense')).toBeUndefined();
  });
});
