import { createBaseAdapter } from './base';

export const geminiAdapter = createBaseAdapter({
  id: 'gemini',
  label: 'Gemini',
  urlPatterns: [/gemini\.google\.com/],
  selectors: {
    container: ['main', '.conversation-container', 'chat-window', '[class*="conversation"]'],
    message: ['user-query', 'model-response'],
    roleUser: ['user-query', '[data-role="user"]'],
    roleAssistant: ['model-response', '[data-role="model"]'],
    content: ['.markdown', '.model-response-text', '.query-text', 'message-content'],
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
    '[class*="suggestion"]',
    '[class*="chip"]',
    '[class*="follow-up"]',
    '[class*="prompt"]',
    '[role="button"]',
  ],
});
