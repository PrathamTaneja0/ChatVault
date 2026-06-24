import { createBaseAdapter } from './base';

export const copilotAdapter = createBaseAdapter({
  id: 'copilot',
  label: 'Copilot',
  urlPatterns: [/copilot\.microsoft\.com/],
  selectors: {
    container: ['main', '.conversation-main', '[data-content="conversation"]'],
    message: [
      '[data-content="user-message"]',
      '[data-content="ai-message"]',
      '.ac-textBlock',
      'cib-message-group',
    ],
    roleUser: ['[data-content="user-message"]', '[data-author="user"]'],
    roleAssistant: ['[data-content="ai-message"]', '[data-author="bot"]'],
    content: ['.ac-textBlock', '.content', '.markdown'],
    title: ['title', '.conversation-title'],
    model: ['[data-content="model-name"]'],
  },
});
