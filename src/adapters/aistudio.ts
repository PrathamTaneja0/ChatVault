import { createBaseAdapter } from './base';

export const aistudioAdapter = createBaseAdapter({
  id: 'aistudio',
  label: 'Google AI Studio',
  urlPatterns: [/aistudio\.google\.com/],
  selectors: {
    container: ['main', '.chat-history', '[class*="conversation"]'],
    message: [
      '.chat-turn',
      '[data-turn]',
      'div[class*="message"]',
    ],
    roleUser: ['[data-turn="user"]', '.user-turn'],
    roleAssistant: ['[data-turn="model"]', '.model-turn'],
    content: ['.turn-content', '.markdown', '.message-text'],
    title: ['title', '.app-title'],
    model: ['.model-selector', '[data-model]'],
  },
});
