import type { ExtensionMessage } from '../../core/messages';

const versionEl = document.getElementById('version');
if (versionEl) {
  versionEl.textContent = `v${browser.runtime.getManifest().version}`;
}

const exportBtn = document.getElementById('export-btn');
const hint = document.getElementById('hint');

exportBtn?.addEventListener('click', async () => {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  try {
    await browser.tabs.sendMessage(tab.id, { type: 'TRIGGER_EXPORT' } satisfies ExtensionMessage);
    window.close();
  } catch {
    if (hint) {
      hint.textContent = 'Open a conversation on a supported AI platform first.';
      hint.classList.add('visible');
    }
  }
});
