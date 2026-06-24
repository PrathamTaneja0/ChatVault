import { createBaseAdapter } from './base';

export const perplexityAdapter = createBaseAdapter({
  id: 'perplexity',
  label: 'Perplexity',
  urlPatterns: [/perplexity\.ai/],
  selectors: {
    container: ['main', '.thread-container', '[class*="Thread"]'],
    message: [
      '[data-testid="user-message"]',
      '[data-testid="assistant-message"]',
      '.prose',
      'div[class*="Message"]',
    ],
    roleUser: ['[data-testid="user-message"]', '[data-author="user"]'],
    roleAssistant: ['[data-testid="assistant-message"]', '[data-author="assistant"]'],
    content: ['.prose', '.markdown-content', '.break-words'],
    title: ['title', '[data-testid="thread-title"]'],
    model: ['[data-testid="model-badge"]'],
  },
});
