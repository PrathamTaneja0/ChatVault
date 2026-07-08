import type { ExtensionMessage, FetchImageResponse } from '../core/messages';

const MAX_RELAY_IMAGE_BYTES = 20 * 1024 * 1024;

export default defineBackground(() => {
  browser.action.onClicked.addListener(async () => {
    await triggerExportOnActiveTab();
  });

  browser.commands.onCommand.addListener(async (command) => {
    if (command !== 'export-chat') return;
    await triggerExportOnActiveTab();
  });

  browser.runtime.onMessage.addListener((message: ExtensionMessage) => {
    if (message?.type === 'FETCH_IMAGE') {
      const url = (message.payload as { url?: string } | undefined)?.url;
      if (typeof url !== 'string' || !/^https?:\/\//.test(url)) {
        return Promise.resolve({ ok: false, error: 'invalid url' } satisfies FetchImageResponse);
      }
      return fetchImageAsDataUrl(url);
    }
    return undefined;
  });
});

/**
 * Content scripts are bound by page CORS; the service worker can fetch any
 * host covered by host_permissions. Returns the image as a data URL since
 * blobs don't survive message passing.
 */
async function fetchImageAsDataUrl(url: string): Promise<FetchImageResponse> {
  try {
    const response = await fetch(url, { credentials: 'include' });
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };

    const blob = await response.blob();
    if (blob.size === 0 || blob.size > MAX_RELAY_IMAGE_BYTES) {
      return { ok: false, error: 'image too large' };
    }
    if (blob.type && !blob.type.startsWith('image/')) {
      return { ok: false, error: `not an image: ${blob.type}` };
    }

    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    const base64 = btoa(binary);
    return { ok: true, dataUrl: `data:${blob.type || 'image/png'};base64,${base64}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'fetch failed' };
  }
}

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
