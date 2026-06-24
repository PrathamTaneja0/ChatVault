import { createBaseAdapter } from './base';

export const deepseekAdapter = createBaseAdapter({
  id: 'deepseek',
  label: 'DeepSeek',
  urlPatterns: [/chat\.deepseek\.com/],
  selectors: {
    container: ['.chat-container', '.ds-scroll-area', 'main', '[class*="scroll"]'],
    message: [
      '[data-message-id]',
      '.ds-message',
      '.message-item',
      'div[class*="message"]',
    ],
    roleUser: ['[data-role="user"]', '.user-message', '[class*="user"]'],
    roleAssistant: ['[data-role="assistant"]', '.assistant-message', '[class*="assistant"]'],
    content: ['.markdown-body', '.message-content', '.ds-markdown'],
    title: ['.chat-title', 'title'],
    model: ['.model-name', '[class*="model"]'],
  },
  useVirtualScroll: true,
  virtualItemSelector: '[data-message-id], .ds-message, .message-item',
});
