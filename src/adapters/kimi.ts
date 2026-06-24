import { createBaseAdapter } from './base';

export const kimiAdapter = createBaseAdapter({
  id: 'kimi',
  label: 'Kimi',
  urlPatterns: [/kimi\.moonshot\.cn/, /kimi\.com/],
  selectors: {
    container: ['main', '.chat-container', '[class*="chat-list"]'],
    message: [
      '[data-testid="message"]',
      '.message-item',
      'div[class*="Message"]',
    ],
    roleUser: ['[data-role="user"]', '.user-message'],
    roleAssistant: ['[data-role="assistant"]', '.assistant-message'],
    content: ['.markdown-body', '.message-content', '.prose'],
    title: ['title', '.chat-title'],
    model: ['.model-selector'],
  },
});
