import { describe, it, expect, afterEach } from 'vitest';
import { findScrollableContainer, isElementScrollable } from '../../src/core/extract-utils';
import { dedupeMessages } from '../../src/core/adapter';
import { generateFilename } from '../../src/core/export';
import type { Conversation, Message } from '../../src/core/schema';

function makeScrollable(el: HTMLElement, scrollHeight: number, clientHeight: number): void {
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true });
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('findScrollableContainer', () => {
  it('returns a candidate that scrolls itself', () => {
    document.body.innerHTML = `<main id="main"></main><div id="scroller"></div>`;
    const main = document.getElementById('main')!;
    const scroller = document.getElementById('scroller')!;
    makeScrollable(main, 100, 100);
    makeScrollable(scroller, 5000, 600);

    const found = findScrollableContainer(document, ['#scroller', 'main']);
    expect(found).toBe(scroller);
  });

  it('finds the scrollable descendant of a non-scrolling candidate', () => {
    document.body.innerHTML = `
      <main id="main">
        <div id="inner-scroller"><div>content</div></div>
      </main>
    `;
    const main = document.getElementById('main')!;
    const inner = document.getElementById('inner-scroller')!;
    makeScrollable(main, 100, 100);
    makeScrollable(inner, 8000, 700);

    const found = findScrollableContainer(document, ['main']);
    expect(found).toBe(inner);
  });

  it('falls back to the first candidate when nothing scrolls', () => {
    document.body.innerHTML = `<main id="main"></main>`;
    const found = findScrollableContainer(document, ['main']);
    expect(found).toBe(document.getElementById('main'));
  });

  it('isElementScrollable requires meaningful overflow', () => {
    const el = document.createElement('div');
    makeScrollable(el, 500, 490);
    expect(isElementScrollable(el)).toBe(false);
    makeScrollable(el, 900, 400);
    expect(isElementScrollable(el)).toBe(true);
  });
});

describe('dedupeMessages (adjacent only)', () => {
  it('removes back-to-back duplicates from selector double-matches', () => {
    const messages: Message[] = [
      { id: '1', role: 'user', content: 'Hi' },
      { id: '2', role: 'user', content: 'Hi' },
      { id: '3', role: 'assistant', content: 'Hello' },
    ];
    expect(dedupeMessages(messages).map((m) => m.id)).toEqual(['1', '3']);
  });

  it('preserves the same text sent again later in the conversation', () => {
    const messages: Message[] = [
      { id: '1', role: 'user', content: 'continue' },
      { id: '2', role: 'assistant', content: 'Part 1…' },
      { id: '3', role: 'user', content: 'continue' },
      { id: '4', role: 'assistant', content: 'Part 2…' },
    ];
    expect(dedupeMessages(messages)).toHaveLength(4);
  });

  it('treats messages with different attachments as distinct', () => {
    const messages: Message[] = [
      {
        id: '1',
        role: 'assistant',
        content: '',
        attachments: [{ id: 'a', kind: 'image', content: 'Image', sourceUrl: 'https://x/1.png' }],
      },
      {
        id: '2',
        role: 'assistant',
        content: '',
        attachments: [{ id: 'b', kind: 'image', content: 'Image', sourceUrl: 'https://x/2.png' }],
      },
    ];
    expect(dedupeMessages(messages)).toHaveLength(2);
  });
});

describe('generateFilename {count}', () => {
  const conversation: Conversation = {
    metadata: {
      title: 'My Chat',
      platform: 'claude',
      platformLabel: 'Claude',
      url: 'https://claude.ai/chat/x',
      exportedAt: '2026-07-08T10:00:00Z',
      messageCount: 3,
    },
    messages: [
      { id: '1', role: 'user', content: 'a' },
      { id: '2', role: 'assistant', content: 'b' },
      { id: '3', role: 'reasoning', content: 'c', isThinking: true },
    ],
  };

  it('counts only the messages that will actually be exported', () => {
    const filename = generateFilename(conversation, {
      includeThinking: false,
      filenameTemplate: 'export_{count}',
    });
    expect(filename).toBe('export_2.pdf');
  });

  it('respects message selection', () => {
    const filename = generateFilename(conversation, {
      includeThinking: true,
      selectedMessageIds: ['1'],
      filenameTemplate: 'export_{count}',
    });
    expect(filename).toBe('export_1.pdf');
  });
});
