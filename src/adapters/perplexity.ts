import { dedupeMessages } from '../core/adapter';
import type { PlatformAdapter } from '../core/adapter';
import type { Conversation, Message } from '../core/schema';
import { extractAttachmentsFromElement } from '../core/attachments';
import {
  cloneContentWithoutExcluded,
  enforceTurnLimit,
  filterNestedMessageElements,
  generateId,
  getPageTitle,
  queryAllFirst,
  scrollSweep,
  sortElementsByDomOrder,
  withCircuitBreaker,
} from '../core/extract-utils';
import { normalizeContent, resolveConversationTitle, stripSuggestionChipText } from '../core/normalize';
import { createBaseAdapter } from './base';

const USER_TURN_SELECTORS = [
  'div[class*="group/query"]',
  '[data-testid="user-message"]',
];

const ASSISTANT_TURN_SELECTORS = [
  'div[id^="markdown-content-"]',
  '[data-testid="assistant-message"]',
];

const USER_EXCLUDE = ['button', '[role="button"]', 'svg'];
const ASSISTANT_EXCLUDE = [
  'button',
  '[role="button"]',
  'nav',
  '[class*="disclaimer"]',
  '[class*="citation"]',
];

const selectors = {
  container: ['main', '.thread-container', '[class*="Thread"]', 'div[class*="threadContentWidth"]'],
  message: [],
  title: ['title', '[data-testid="thread-title"]'],
  model: ['[data-testid="model-badge"]'],
};

const base = createBaseAdapter({
  id: 'perplexity',
  label: 'Perplexity',
  urlPatterns: [/perplexity\.ai/],
  selectors: {
    ...selectors,
    message: USER_TURN_SELECTORS,
    roleUser: USER_TURN_SELECTORS,
    roleAssistant: ASSISTANT_TURN_SELECTORS,
    content: ['.prose', '.markdown-content', '.break-words', 'span.select-text'],
  },
  diagnosticSelectors: [
    { name: 'User queries', selector: 'div[class*="group/query"]' },
    { name: 'Assistant responses', selector: 'div[id^="markdown-content-"]' },
  ],
});

function collectTurns(document: Document, selectorList: string[]): Element[] {
  const seen = new Set<Element>();
  const merged: Element[] = [];
  for (const sel of selectorList) {
    for (const el of document.querySelectorAll(sel)) {
      if (!seen.has(el)) {
        seen.add(el);
        merged.push(el);
      }
    }
  }
  return filterNestedMessageElements(sortElementsByDomOrder(merged));
}

function extractUserTurn(el: Element, index: number): Message | null {
  const excludeList = USER_EXCLUDE;
  const clone = cloneContentWithoutExcluded(el, excludeList);
  let html = clone.innerHTML;
  let content = clone.textContent?.trim() ?? '';

  const attachments = extractAttachmentsFromElement(el, 'user', 'perplexity', index);
  const prev = el.previousElementSibling;
  if (prev && (prev.textContent?.includes('PASTED') || prev.className?.toString().includes('paste'))) {
    const pasteClone = cloneContentWithoutExcluded(prev, excludeList);
    const pasteHtml = pasteClone.innerHTML;
    if (pasteHtml && !html.includes(pasteHtml.slice(0, 40))) {
      html = `${pasteHtml}${html}`;
    }
    const pasteText = pasteClone.textContent?.trim() ?? '';
    if (pasteText && !content.includes(pasteText.slice(0, 40))) {
      content = content ? `${pasteText}\n\n${content}` : pasteText;
    }
  }

  content = stripSuggestionChipText(content);
  if (!content) return null;

  return {
    id: generateId('perplexity', index),
    role: 'user',
    content,
    html,
    attachments: attachments.length > 0 ? attachments : undefined,
  };
}

function extractAssistantTurn(el: Element, index: number): Message | null {
  const contentEl =
    el.querySelector('.prose') ??
    el.querySelector('.markdown-content') ??
    el;
  const clone = cloneContentWithoutExcluded(contentEl, ASSISTANT_EXCLUDE);
  let content = clone.textContent?.trim() ?? '';
  content = content.replace(/This response is AI-generated, for reference only\.?/gi, '').trim();
  content = stripSuggestionChipText(content);
  if (!content) return null;

  return {
    id: generateId('perplexity', index),
    role: 'assistant',
    content,
    html: clone.innerHTML,
  };
}

function mergeTurnsByDomOrder(document: Document): Message[] {
  const userEls = collectTurns(document, USER_TURN_SELECTORS);
  const assistantEls = collectTurns(document, ASSISTANT_TURN_SELECTORS);

  const tagged = [
    ...userEls.map((el) => ({ el, role: 'user' as const })),
    ...assistantEls.map((el) => ({ el, role: 'assistant' as const })),
  ];

  tagged.sort((a, b) => {
    const pos = a.el.compareDocumentPosition(b.el);
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });

  const messages: Message[] = [];
  tagged.forEach(({ el, role }, index) => {
    const msg =
      role === 'user' ? extractUserTurn(el, index) : extractAssistantTurn(el, index);
    if (msg) messages.push(msg);
  });

  return messages;
}

export const perplexityAdapter: PlatformAdapter = {
  ...base,

  async extract(document, onProgress, signal) {
    return withCircuitBreaker(async () => {
      onProgress?.({ phase: 'detecting', message: 'Detecting Perplexity chat…', percent: 0 });

      const container = queryAllFirst(document, selectors.container)[0]
        ?? document.querySelector('main')
        ?? document.body;

      await scrollSweep(container, onProgress, signal);

      onProgress?.({ phase: 'extracting', message: 'Extracting messages…', percent: 50 });

      const raw = mergeTurnsByDomOrder(document);
      const deduped = dedupeMessages(raw);
      enforceTurnLimit(deduped.length);

      const titleCandidates: string[] = [];
      for (const sel of selectors.title ?? []) {
        document.querySelectorAll(sel).forEach((el) => {
          const t = el.textContent?.trim();
          if (t) titleCandidates.push(t);
        });
      }
      titleCandidates.push(getPageTitle(document));
      const firstUser = deduped.find((m) => m.role === 'user');
      if (firstUser) {
        titleCandidates.push(normalizeContent(firstUser).slice(0, 100));
      }

      const modelEl = selectors.model ? queryAllFirst(document, selectors.model)[0] : null;

      onProgress?.({ phase: 'done', message: `Extracted ${deduped.length} messages`, percent: 100 });

      return {
        metadata: {
          title: resolveConversationTitle(titleCandidates, 'Perplexity'),
          platform: 'perplexity',
          platformLabel: 'Perplexity',
          model: modelEl?.textContent?.trim(),
          url: document.location?.href ?? '',
          exportedAt: new Date().toISOString(),
          messageCount: deduped.length,
        },
        messages: deduped,
      } satisfies Conversation;
    }, signal);
  },
};
