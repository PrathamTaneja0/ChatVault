import type { ExtensionMessage } from '../core/messages';

export default defineBackground(() => {
  browser.commands.onCommand.addListener(async (command) => {
    if (command !== 'export-chat') return;

    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    try {
      await browser.tabs.sendMessage(tab.id, {
        type: 'TRIGGER_EXPORT',
      } satisfies ExtensionMessage);
    } catch {
      /* content script not loaded on this tab */
    }
  });

  browser.runtime.onMessage.addListener(
    (message: ExtensionMessage, _sender, sendResponse) => {
      if (message.type === 'START_EXPORT') {
        handleStartExport(message.payload as { tabId: number })
          .then(sendResponse)
          .catch((err) => sendResponse({ error: String(err) }));
        return true;
      }
      return false;
    },
  );
});

async function handleStartExport(payload: { tabId: number }): Promise<unknown> {
  return browser.tabs.sendMessage(payload.tabId, { type: 'TRIGGER_EXPORT' });
}
