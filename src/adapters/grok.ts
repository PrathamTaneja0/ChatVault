import { createBaseAdapter } from './base';

export const grokAdapter = createBaseAdapter({
  id: 'grok',
  label: 'Grok',
  urlPatterns: [/grok\.com/, /x\.com/i],
  selectors: {
    container: ['main', '[data-testid="conversation"]', '.conversation'],
    message: [
      '[data-testid="message"]',
      '.message-bubble',
      'div[class*="Message"]',
    ],
    roleUser: ['[data-testid="user-message"]', '[data-author="user"]'],
    roleAssistant: ['[data-testid="assistant-message"]', '[data-author="assistant"]'],
    content: ['.message-content', '.markdown', '.prose'],
    title: ['title', '[data-testid="chat-title"]'],
    model: ['[data-testid="model-name"]'],
  },
});
