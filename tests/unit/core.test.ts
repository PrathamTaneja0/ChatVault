import { describe, it, expect } from 'vitest';
import type { Message } from '../../src/core/schema';
import { dedupeMessages } from '../../src/core/adapter';
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
