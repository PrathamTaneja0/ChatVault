import { createBaseAdapter } from './base';

export const notebooklmAdapter = createBaseAdapter({
  id: 'notebooklm',
  label: 'NotebookLM',
  urlPatterns: [/notebooklm\.google\.com/],
  selectors: {
    container: ['main', '.chat-panel', '[class*="chat"]'],
    message: [
      '.chat-message',
      '[data-message-type]',
      'div[class*="Message"]',
    ],
    roleUser: ['[data-message-type="user"]', '.user-message'],
    roleAssistant: ['[data-message-type="model"]', '.model-message'],
    content: ['.message-content', '.markdown', '.prose'],
    title: ['title', '.notebook-title'],
    model: ['.model-indicator'],
  },
});
