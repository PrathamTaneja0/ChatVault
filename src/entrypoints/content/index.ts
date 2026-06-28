import { initAdapters } from '../../adapters';
import { getAdapterForUrl } from '../../core/registry';
import { loadOptions } from '../../core/storage';
import { ExportOverlay, handleDownloadExport } from '../../ui/overlay';
import { createFab } from '../../ui/fab';
import type { ExtensionMessage } from '../../core/messages';
import { CircuitBreakerError } from '../../core/extract-utils';

initAdapters();

let overlay: ExportOverlay | null = null;
let fab: HTMLElement | null = null;
let isExporting = false;

function setup(): void {
  const adapter = getAdapterForUrl(window.location.href);
  if (!adapter) return;

  if (!fab) {
    fab = createFab(() => void startExport());
    document.body.appendChild(fab);
  }
}

async function handleMessage(message: ExtensionMessage): Promise<unknown> {
  switch (message.type) {
    case 'TRIGGER_EXPORT':
      await startExport();
      return { ok: true };
    case 'GET_STATUS': {
      const adapter = getAdapterForUrl(window.location.href);
      return {
        platform: adapter?.id ?? null,
        platformLabel: adapter?.label ?? null,
        url: window.location.href,
        supported: !!adapter,
      };
    }
    case 'GET_DIAGNOSTICS': {
      const adapter = getAdapterForUrl(window.location.href);
      const diagnostics = adapter?.getSelectorDiagnostics?.(document) ?? [];
      return { platform: adapter?.id ?? null, diagnostics };
    }
    default:
      return undefined;
  }
}

async function startExport(): Promise<void> {
  if (isExporting) return;

  const adapter = getAdapterForUrl(window.location.href);
  if (!adapter) {
    alert('ChatVault Export: This page is not supported.');
    return;
  }

  isExporting = true;
  overlay = new ExportOverlay();

  const finishExport = (): void => {
    overlay = null;
    isExporting = false;
  };

  overlay.showExtracting(finishExport);

  const options = await loadOptions();
  const signal = overlay.getAbortSignal();

  try {
    const conversation = await adapter.extract(
      document,
      (progress) => overlay?.updateProgress?.(progress),
      signal,
    );

    overlay.showPreview(conversation, options, {
      onDownload: async (conv, exportOpts) => {
        await handleDownloadExport(conv, exportOpts);
      },
      onCancel: finishExport,
      onClose: finishExport,
    });
  } catch (err) {
    const msg =
      err instanceof CircuitBreakerError
        ? err.message
        : err instanceof Error
          ? err.message
          : 'Unknown error';
    alert(`ChatVault Export failed: ${msg}`);
    overlay?.closeOverlay();
  }
}

export default defineContentScript({
  matches: [
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
    'https://notebooklm.google.com/*',
    'https://aistudio.google.com/*',
  ],
  runAt: 'document_idle',
  main() {
    setup();
    browser.runtime.onMessage.addListener(handleMessage);
  },
});
