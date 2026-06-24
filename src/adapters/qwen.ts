import { createBaseAdapter } from './base';

export const qwenAdapter = createBaseAdapter({
  id: 'qwen',
  label: 'Qwen',
  urlPatterns: [/chat\.qwen\.ai/, /qwen\.ai/],
  selectors: {
    container: ['main', '.chat-container', '[class*="conversation"]'],
    message: [
      '.message-item',
      '[data-message-id]',
      'div[class*="message"]',
    ],
    roleUser: ['[data-role="user"]', '.user-message'],
    roleAssistant: ['[data-role="assistant"]', '.bot-message'],
    content: ['.markdown', '.message-text', '.content'],
    title: ['title', '.session-title'],
    model: ['.model-name'],
  },
});
