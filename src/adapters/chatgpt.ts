import { createBaseAdapter } from './base';
import { enforceTurnLimit, waitForStreaming, withCircuitBreaker } from '../core/extract-utils';
import type { Conversation } from '../core/schema';
import type { PlatformAdapter } from '../core/adapter';
import { extractChatGptViaApi } from '../sources/chatgpt-api';

const selectors = {
  container: ['main', '[role="main"]', '.flex.flex-col.text-sm'],
  message: [
    '[data-message-author-role]',
    'article[data-testid^="conversation-turn"]',
    'div.group.w-full',
  ],
  content: [
    '.markdown',
    '.prose',
    '[data-message-id] .markdown',
    '.text-message',
  ],
  title: [
    'nav a[aria-current="page"]',
    '[data-testid="conversation-title"]',
    'title',
  ],
  model: [
    '[data-testid="model-switcher-dropdown-button"]',
    'button[data-testid="model-switcher"]',
  ],
  streaming: [
    '[data-testid="stop-button"]',
    'button[aria-label="Stop streaming"]',
  ],
  thinking: [
    '.thinking',
    '[data-thinking]',
  ],
};

const base = createBaseAdapter({
  id: 'chatgpt',
  label: 'ChatGPT',
  urlPatterns: [/chatgpt\.com/, /chat\.openai\.com/],
  selectors,
});

export const chatgptAdapter: PlatformAdapter = {
  ...base,

  async extract(document, onProgress, signal) {
    return withCircuitBreaker(async () => {
      onProgress?.({ phase: 'waiting', message: 'Checking for active streaming…', percent: 2 });

      await waitForStreaming(
        () => !!document.querySelector(selectors.streaming[0] ?? '') ||
          !!document.querySelector(selectors.streaming[1] ?? ''),
        onProgress,
        signal,
      );

      const location = document.location;
      if (location?.href) {
        onProgress?.({ phase: 'detecting', message: 'Fetching conversation from ChatGPT…', percent: 5 });
        const viaApi = await extractChatGptViaApi(location, signal).catch(() => null);
        if (viaApi && viaApi.messages.length > 0) {
          enforceTurnLimit(viaApi.messages.length);
          onProgress?.({
            phase: 'done',
            message: `Extracted ${viaApi.messages.length} messages`,
            percent: 100,
          });
          return viaApi;
        }
        console.info('[ChatVault] ChatGPT API extraction unavailable — falling back to page DOM');
      }

      const { scrollSweep, findScrollableContainer } = await import('../core/extract-utils');
      const container = findScrollableContainer(document, selectors.container, selectors.message);
      await scrollSweep(container, onProgress, signal, { stepPx: 600, delayMs: 400 });

      return base.extract(document, onProgress, signal) as Promise<Conversation>;
    }, signal);
  },
};
