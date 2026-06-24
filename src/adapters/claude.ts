import { createBaseAdapter } from './base';

export const claudeAdapter = createBaseAdapter({
  id: 'claude',
  label: 'Claude',
  urlPatterns: [/claude\.ai/],
  selectors: {
    container: ['main', '.flex-1.overflow-y-auto', '[data-testid="conversation"]'],
    message: [
      '[data-testid="user-message"]',
      '[data-testid="assistant-message"]',
      '.font-user-message',
      '.font-claude-message',
      'div[class*="Message"]',
    ],
    roleUser: ['[data-testid="user-message"]', '.font-user-message'],
    roleAssistant: ['[data-testid="assistant-message"]', '.font-claude-message'],
    content: ['.prose', '.font-claude-message', '.font-user-message', '.markdown'],
    title: ['[data-testid="chat-title"]', 'title'],
    model: ['[data-testid="model-selector"]'],
    thinking: ['.thinking-block', '[data-is-thinking]'],
  },
});
