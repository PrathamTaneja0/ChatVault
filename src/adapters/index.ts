import { registerAdapter } from '../core/registry';
import { chatgptAdapter } from './chatgpt';
import { claudeAdapter } from './claude';
import { deepseekAdapter } from './deepseek';
import { geminiAdapter } from './gemini';
import { grokAdapter } from './grok';
import { perplexityAdapter } from './perplexity';
import { copilotAdapter } from './copilot';
import { poeAdapter } from './poe';
import { kimiAdapter } from './kimi';
import { qwenAdapter } from './qwen';
import { notebooklmAdapter } from './notebooklm';
import { aistudioAdapter } from './aistudio';

const allAdapters = [
  chatgptAdapter,
  claudeAdapter,
  deepseekAdapter,
  geminiAdapter,
  grokAdapter,
  perplexityAdapter,
  copilotAdapter,
  poeAdapter,
  kimiAdapter,
  qwenAdapter,
  notebooklmAdapter,
  aistudioAdapter,
];

export function initAdapters(): void {
  for (const adapter of allAdapters) {
    registerAdapter(adapter);
  }
}

export {
  chatgptAdapter,
  claudeAdapter,
  deepseekAdapter,
  geminiAdapter,
  grokAdapter,
  perplexityAdapter,
  copilotAdapter,
  poeAdapter,
  kimiAdapter,
  qwenAdapter,
  notebooklmAdapter,
  aistudioAdapter,
};
