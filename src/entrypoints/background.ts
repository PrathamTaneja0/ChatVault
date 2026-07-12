import type { ExtensionMessage } from '../core/messages';

// Toolbar clicks open the popup (default_popup); only the keyboard shortcut
// needs background routing.
export default defineBackground(() => {
  browser.commands.onCommand.addListener(async (command) => {
    if (command !== 'export-chat') return;
    await triggerExportOnActiveTab();
  });
});

async function triggerExportOnActiveTab(): Promise<void> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  try {
    await browser.tabs.sendMessage(tab.id, {
      type: 'TRIGGER_EXPORT',
    } satisfies ExtensionMessage);
  } catch {
    /* content script not loaded on this tab */
  }
}
