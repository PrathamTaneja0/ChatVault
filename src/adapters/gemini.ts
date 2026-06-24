import { createBaseAdapter } from './base';

export const geminiAdapter = createBaseAdapter({
  id: 'gemini',
  label: 'Gemini',
  urlPatterns: [/gemini\.google\.com/],
  selectors: {
    container: ['main', '.conversation-container', 'chat-window', '[class*="conversation"]'],
    message: [
      'user-query',
      'model-response',
      '.query-content',
      '.response-content',
      'message-content',
    ],
    roleUser: ['user-query', '.query-content', '[data-role="user"]'],
    roleAssistant: ['model-response', '.response-content', '[data-role="model"]'],
    content: ['.markdown', '.model-response-text', '.query-text', 'message-content'],
    title: ['.conversation-title', 'title'],
    model: ['.model-picker', '[data-model-name]'],
  },
});
