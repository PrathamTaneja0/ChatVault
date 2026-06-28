import { describe, it, expect } from 'vitest';
import type { Message } from '../../src/core/schema';
import { dedupeMessages, filterMessages, getSelectableMessages } from '../../src/core/adapter';
import { DEFAULT_EXPORT_OPTIONS } from '../../src/core/schema';
import { generateFilename, htmlToPdfMakeContent, extractMainHtml } from '../../src/core/export';
import { cloneContentWithoutExcluded, queryAllMerged } from '../../src/core/extract-utils';
import { renderConversationHtml } from '../../src/core/render';
import {
  applyFilenameTemplate,
  normalizeContent,
  resolveConversationTitle,
  sanitizeFilenamePart,
  slugify,
  stripPlatformPrefixes,
  stripSuggestionChipText,
  getTurndown,
} from '../../src/core/normalize';

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

describe('queryAllMerged', () => {
  it('merges multiple selectors in DOM order without duplicates', () => {
    document.body.innerHTML = `
      <div id="root">
        <user-query>u1</user-query>
        <model-response>a1</model-response>
        <user-query>u2</user-query>
      </div>
    `;
    const root = document.getElementById('root')!;
    const els = queryAllMerged(root, ['user-query', 'model-response']);
    expect(els).toHaveLength(3);
    expect(els[0].tagName.toLowerCase()).toBe('user-query');
    expect(els[1].tagName.toLowerCase()).toBe('model-response');
    expect(els[2].tagName.toLowerCase()).toBe('user-query');
  });
});

describe('resolveConversationTitle', () => {
  it('skips generic placeholders and uses document title', () => {
    const result = resolveConversationTitle(
      ['Conversation with', 'ADHD and Housing - Google Gemini'],
      'Gemini',
    );
    expect(result).toBe('ADHD and Housing');
  });

  it('falls back to first user message snippet', () => {
    const result = resolveConversationTitle(
      ['Conversation with', 'New chat'],
      'Gemini',
    );
    expect(result).toBe('Conversation with');
  });
});

describe('stripSuggestionChipText', () => {
  it('removes trailing Yes chip line', () => {
    const input = 'Register with UAB PIUNE for ADHD\nYes';
    expect(stripSuggestionChipText(input)).toBe('Register with UAB PIUNE for ADHD');
  });

  it('keeps single-line content unchanged', () => {
    expect(stripSuggestionChipText('Only one line')).toBe('Only one line');
  });
});

describe('cloneContentWithoutExcluded', () => {
  it('removes button elements from cloned content', () => {
    document.body.innerHTML = `
      <div id="content">
        <p>Main answer text</p>
        <button>Yes</button>
      </div>
    `;
    const el = document.getElementById('content')!;
    const clone = cloneContentWithoutExcluded(el, ['button']);
    expect(clone.textContent?.trim()).toBe('Main answer text');
    expect(clone.querySelector('button')).toBeNull();
  });
});

describe('htmlToPdfMakeContent', () => {
  it('converts bold HTML to pdfmake bold text, not raw markdown', async () => {
    const html = `<!DOCTYPE html><html><body><main class="conversation">
      <section class="message"><div class="message-body"><p><strong>bold word</strong></p></div></section>
    </main></body></html>`;
    const content = await htmlToPdfMakeContent(html);
    const serialized = JSON.stringify(content);
    expect(serialized).not.toContain('**bold word**');
    expect(serialized).toContain('bold word');
  });
});

describe('extractMainHtml', () => {
  it('extracts main conversation inner HTML', () => {
    const html = '<html><body><main class="conversation"><p>Hello</p></main></body></html>';
    expect(extractMainHtml(html)).toContain('<p>Hello</p>');
  });
});

describe('preview render CSS', () => {
  it('includes document margins in preview mode', () => {
    const html = renderConversationHtml(
      {
        metadata: {
          title: 'Test',
          platform: 'gemini',
          platformLabel: 'Gemini',
          url: 'https://example.com',
          exportedAt: '2026-06-28T00:00:00.000Z',
          messageCount: 1,
        },
        messages: [{ id: '1', role: 'user', content: 'Hi' }],
      },
      DEFAULT_EXPORT_OPTIONS,
      'preview',
    );
    expect(html).toContain('padding: 25.4mm');
  });
});

describe('renderConversationHtml', () => {
  const baseConversation = {
    metadata: {
      title: 'Test Chat',
      platform: 'gemini',
      platformLabel: 'Gemini',
      url: 'https://example.com',
      exportedAt: '2026-06-28T00:00:00.000Z',
      messageCount: 2,
    },
    messages: [
      { id: '1', role: 'user' as const, content: 'Question' },
      { id: '2', role: 'assistant' as const, content: 'Answer text' },
    ],
  };

  it('applies role label classes for heading-only styling', () => {
    const html = renderConversationHtml(baseConversation, DEFAULT_EXPORT_OPTIONS);
    expect(html).toContain('message-role message-role-user');
    expect(html).toContain('message-role message-role-assistant');
  });

  it('styles message body text in black', () => {
    const html = renderConversationHtml(baseConversation, DEFAULT_EXPORT_OPTIONS);
    expect(html).toContain('.message-body');
    expect(html).toContain('color: #000000');
  });

  it('does not render a table of contents even with many messages', () => {
    const messages = Array.from({ length: 12 }, (_, i) => ({
      id: String(i + 1),
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `Message ${i + 1}`,
    }));
    const html = renderConversationHtml(
      { ...baseConversation, messages, metadata: { ...baseConversation.metadata, messageCount: 12 } },
      DEFAULT_EXPORT_OPTIONS,
    );
    expect(html).not.toContain('Table of Contents');
    expect(html).not.toContain('class="toc"');
  });

  it('excludes thinking messages when includeThinking is false', () => {
    const html = renderConversationHtml(
      {
        ...baseConversation,
        messages: [
          { id: '1', role: 'user', content: 'Hi' },
          { id: '2', role: 'reasoning', content: 'Thinking…', isThinking: true },
          { id: '3', role: 'assistant', content: 'Hello' },
        ],
      },
      { ...DEFAULT_EXPORT_OPTIONS, includeThinking: false },
    );
    expect(html).not.toContain('message-role-reasoning');
    expect(html).toContain('message-role-assistant');
  });
});

describe('stripPlatformPrefixes', () => {
  it('removes Gemini "You said" prefix', () => {
    expect(stripPlatformPrefixes('You said hello world')).toBe('hello world');
  });
});

describe('normalizeContent', () => {
  it('strips platform prefix from plain content', () => {
    const msg: Message = { id: '1', role: 'user', content: 'You said https://example.com' };
    expect(normalizeContent(msg)).toBe('https://example.com');
  });
});

describe('sanitizeFilenamePart', () => {
  it('keeps readable words with underscores', () => {
    expect(sanitizeFilenamePart('ADHD and University Housing')).toBe(
      'ADHD_and_University_Housing',
    );
  });
});

describe('generateFilename', () => {
  it('uses ChatVault_{title} default template', () => {
    const filename = generateFilename(
      {
        metadata: {
          title: 'My Chat Thread',
          platform: 'gemini',
          platformLabel: 'Gemini',
          url: 'https://gemini.google.com',
          exportedAt: '2026-06-28T00:00:00.000Z',
          messageCount: 2,
        },
        messages: [],
      },
      DEFAULT_EXPORT_OPTIONS,
    );
    expect(filename).toBe('ChatVault_My_Chat_Thread.pdf');
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
