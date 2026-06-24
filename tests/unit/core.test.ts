import { describe, it, expect } from 'vitest';
import type { Message } from '../../src/core/schema';
import { dedupeMessages, filterMessages, getSelectableMessages } from '../../src/core/adapter';
import { DEFAULT_EXPORT_OPTIONS } from '../../src/core/schema';
import { applyFilenameTemplate, slugify, getTurndown } from '../../src/core/normalize';

describe('schema', () => {
  it('creates valid message objects', () => {
    const msg: Message = {
      id: 'test-1',
      role: 'user',
      content: 'Hello',
    };
    expect(msg.role).toBe('user');
    expect(msg.content).toBe('Hello');
  });
});

describe('filterMessages', () => {
  const messages: Message[] = [
    { id: '1', role: 'user', content: 'Hi' },
    { id: '2', role: 'assistant', content: 'Hello' },
    { id: '3', role: 'reasoning', content: 'Thinking…', isThinking: true },
  ];

  it('filters by selected message ids', () => {
    const result = filterMessages(messages, {
      ...DEFAULT_EXPORT_OPTIONS,
      selectedMessageIds: ['1', '2'],
    });
    expect(result).toHaveLength(2);
    expect(result.map((m) => m.id)).toEqual(['1', '2']);
  });

  it('returns no messages when selection is empty', () => {
    const result = filterMessages(messages, {
      ...DEFAULT_EXPORT_OPTIONS,
      selectedMessageIds: [],
    });
    expect(result).toHaveLength(0);
  });

  it('excludes thinking when includeThinking is false', () => {
    const result = filterMessages(messages, {
      ...DEFAULT_EXPORT_OPTIONS,
      includeThinking: false,
    });
    expect(result).toHaveLength(2);
    expect(result.every((m) => m.role !== 'reasoning')).toBe(true);
  });
});

describe('getSelectableMessages', () => {
  it('omits thinking messages when disabled', () => {
    const messages: Message[] = [
      { id: '1', role: 'user', content: 'Hi' },
      { id: '2', role: 'reasoning', content: 'Think', isThinking: true },
    ];
    const result = getSelectableMessages(messages, {
      ...DEFAULT_EXPORT_OPTIONS,
      includeThinking: false,
    });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
  });
});

describe('dedupeMessages', () => {
  it('removes duplicate messages by role+content', () => {
    const messages: Message[] = [
      { id: '1', role: 'user', content: 'Hi' },
      { id: '2', role: 'user', content: 'Hi' },
      { id: '3', role: 'assistant', content: 'Hello' },
    ];
    const result = dedupeMessages(messages);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('1');
    expect(result[1].id).toBe('3');
  });

  it('preserves unique messages', () => {
    const messages: Message[] = [
      { id: '1', role: 'user', content: 'A' },
      { id: '2', role: 'assistant', content: 'B' },
    ];
    expect(dedupeMessages(messages)).toHaveLength(2);
  });
});

describe('applyFilenameTemplate', () => {
  it('substitutes template variables', () => {
    const result = applyFilenameTemplate('{platform}_{title}_{date}', {
      platform: 'chatgpt',
      title: 'my-chat',
      date: '2026-06-24',
    });
    expect(result).toBe('chatgpt_my-chat_2026-06-24');
  });

  it('removes invalid filename characters', () => {
    const result = applyFilenameTemplate('{title}', {
      title: 'hello/world:test',
    });
    expect(result).not.toContain('/');
    expect(result).not.toContain(':');
  });
});

describe('slugify', () => {
  it('converts text to slug', () => {
    expect(slugify('Hello World!')).toBe('hello-world');
  });

  it('truncates to max length', () => {
    const long = 'a'.repeat(100);
    expect(slugify(long, 20).length).toBeLessThanOrEqual(20);
  });
});

describe('turndown', () => {
  it('converts HTML to markdown', () => {
    const td = getTurndown();
    const md = td.turndown('<p>Hello <strong>world</strong></p>');
    expect(md).toContain('Hello');
    expect(md).toContain('**world**');
  });

  it('converts pre/code blocks to fenced code', () => {
    const td = getTurndown();
    const md = td.turndown('<pre><code class="language-js">const x = 1;</code></pre>');
    expect(md).toContain('```');
    expect(md).toContain('const x = 1;');
  });
});
