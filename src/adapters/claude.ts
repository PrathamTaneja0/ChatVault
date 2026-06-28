import { createBaseAdapter } from './base';

export const claudeAdapter = createBaseAdapter({
  id: 'claude',
  label: 'Claude',
  urlPatterns: [/claude\.ai/],
  selectors: {
    container: ['main', '.flex-1.overflow-y-auto', '[data-testid="conversation"]'],
    message: [
      '[data-testid="user-message"]',
      '.font-claude-response',
      '[data-is-streaming]',
      '[class*="font-user-message"]',
      '[data-testid="assistant-message"]',
      '[data-testid="ai-message"]',
      '.font-claude-message',
    ],
    roleUser: ['[data-testid="user-message"]', '[class*="font-user-message"]'],
    roleAssistant: [
      '.font-claude-response',
      '[data-is-streaming]',
      '[data-testid="assistant-message"]',
      '[data-testid="ai-message"]',
      '.font-claude-message',
    ],
    content: [
      '.standard-markdown',
      '.progressive-markdown',
      '.font-claude-response-body',
      '[class*="markdown"]',
      '[class*="font-user-message"]',
      '[class*="font-claude-response"]',
      '.markdown',
      '.prose',
    ],
    title: ['[data-testid="chat-title"]', 'title'],
    model: ['[data-testid="model-selector"]'],
    thinking: ['.thinking-block', '[data-is-thinking]'],
  },
  diagnosticSelectors: [
    { name: 'User messages', selector: '[data-testid="user-message"]' },
    { name: 'Assistant messages', selector: '.font-claude-response' },
  ],
  excludeSelectors: [
    'button[data-testid="action-bar-copy"]',
    '[data-testid="action-bar"]',
    '[aria-label="Message actions"]',
    '.artifact-block-cell',
  ],
});
