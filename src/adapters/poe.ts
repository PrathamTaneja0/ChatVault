import { createBaseAdapter } from './base';

export const poeAdapter = createBaseAdapter({
  id: 'poe',
  label: 'Poe',
  urlPatterns: [/poe\.com/],
  selectors: {
    container: ['main', '.ChatMessagesView', '[class*="ChatMessage"]'],
    message: [
      '[class*="ChatMessage"]',
      '.Message_botMessageBubble',
      '.Message_humanMessageBubble',
    ],
    roleUser: ['.Message_humanMessageBubble', '[class*="humanMessage"]'],
    roleAssistant: ['.Message_botMessageBubble', '[class*="botMessage"]'],
    content: ['.Markdown_markdown', '.Message_selectableText', '.prose'],
    title: ['title', '[class*="ChatHeader"]'],
    model: ['[class*="BotName"]'],
  },
});
