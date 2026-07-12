import { createBaseAdapter } from './base';

export const geminiAdapter = createBaseAdapter({
  id: 'gemini',
  label: 'Gemini',
  urlPatterns: [/gemini\.google\.com/],
  selectors: {
    // Ordered: likely scroll containers first — findScrollableContainer picks
    // the first candidate (or candidate descendant/ancestor) that actually scrolls.
    container: [
      '#chat-history',
      'infinite-scroller',
      '[data-test-id="chat-history-container"]',
      '.chat-history',
      'chat-window',
      '.conversation-container',
      'main',
      '[class*="conversation"]',
    ],
    message: ['user-query', 'model-response'],
    roleUser: ['user-query', '[data-role="user"]'],
    roleAssistant: ['model-response', '[data-role="model"]'],
    content: [
      '.markdown',
      'message-content',
      '.model-response-text',
      '.markdown-main-panel',
      '.query-text',
    ],
    title: [
      'title',
      'nav a[aria-current="page"]',
      '[data-conversation-title]',
      '.conversation-title',
    ],
    model: ['.model-picker', '[data-model-name]'],
  },
  diagnosticSelectors: [
    { name: 'User messages', selector: 'user-query' },
    { name: 'Assistant messages', selector: 'model-response' },
  ],
  excludeSelectors: [
    'button',
    // Thought/reasoning panels are collapsed UI chrome inside the response;
    // stripping them keeps the answer text clean instead of mislabeling the
    // whole message as reasoning.
    'model-thoughts',
    '[class*="thoughts-header"]',
    '[class*="suggestion"]',
    '[class*="chip"]',
    '[class*="follow-up"]',
    '[class*="prompt"]',
    '[role="button"]',
    'sources-list',
    '[class*="disclaimer"]',
  ],
});
