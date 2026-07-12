import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  outDir: '.output',
  manifest: {
    name: 'ChatVault Export',
    description: 'Export AI chat conversations to beautifully formatted PDFs',
    version: '2.0.0',
    // scripting/downloads were declared but never used; keep the surface minimal
    permissions: ['activeTab', 'storage', 'clipboardRead'],
    host_permissions: [
      'https://chatgpt.com/*',
      'https://chat.openai.com/*',
      'https://claude.ai/*',
      'https://chat.deepseek.com/*',
      'https://gemini.google.com/*',
      'https://grok.com/*',
      'https://x.com/*',
      'https://www.perplexity.ai/*',
      'https://copilot.microsoft.com/*',
      'https://poe.com/*',
      'https://kimi.moonshot.cn/*',
      'https://kimi.com/*',
      'https://chat.qwen.ai/*',
      'https://qwen.ai/*',
      'https://notebooklm.google.com/*',
      'https://aistudio.google.com/*',
    ],
    action: {
      default_title: 'ChatVault Export',
    },
    icons: {
      16: 'icon/16.png',
      48: 'icon/48.png',
      128: 'icon/128.png',
    },
    commands: {
      'export-chat': {
        suggested_key: {
          default: 'Ctrl+Shift+E',
          mac: 'Command+Shift+E',
        },
        description: 'Export current chat to PDF',
      },
    },
  },
});
