import type { Conversation, ExportOptions } from '../core/schema';
import type { ExtractionProgress } from '../core/adapter';
import { createProgressBar, progressStyles } from './progress';
import { buildExportDocument, printViaIframe, silentDownload } from '../core/export';

export type OverlayAction = 'print' | 'download' | 'cancel';

export interface OverlayCallbacks {
  onPrint: (conversation: Conversation) => Promise<void>;
  onDownload: (conversation: Conversation) => Promise<void>;
  onCancel: () => void;
  onClose: () => void;
}

const OVERLAY_STYLES = `
  :host { all: initial; }
  .cv-overlay-backdrop {
    position: fixed;
    inset: 0;
    z-index: 2147483647;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'Inter', system-ui, sans-serif;
  }
  .cv-overlay-panel {
    background: #fff;
    border-radius: 12px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
    width: min(900px, 92vw);
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .cv-overlay-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid #e5e7eb;
  }
  .cv-overlay-header h2 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: #111827;
  }
  .cv-overlay-close {
    background: none;
    border: none;
    cursor: pointer;
    padding: 4px;
    color: #6b7280;
    font-size: 20px;
    line-height: 1;
  }
  .cv-overlay-body {
    flex: 1;
    overflow: auto;
    padding: 0;
  }
  .cv-overlay-preview {
    width: 100%;
    height: 400px;
    border: none;
  }
  .cv-overlay-footer {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 16px 20px;
    border-top: 1px solid #e5e7eb;
    justify-content: flex-end;
  }
  .cv-btn {
    padding: 8px 16px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    border: none;
    transition: background 0.15s;
  }
  .cv-btn-primary {
    background: #4F46E5;
    color: white;
  }
  .cv-btn-primary:hover { background: #4338ca; }
  .cv-btn-secondary {
    background: #059669;
    color: white;
  }
  .cv-btn-secondary:hover { background: #047857; }
  .cv-btn-ghost {
    background: #f3f4f6;
    color: #374151;
  }
  .cv-btn-ghost:hover { background: #e5e7eb; }
  .cv-extracting {
    padding: 40px 20px;
    text-align: center;
  }
  ${progressStyles}
`;

export class ExportOverlay {
  private host: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private abortController: AbortController | null = null;
  private focusableElements: HTMLElement[] = [];
  private previouslyFocused: Element | null = null;

  showExtracting(onCancel: () => void): void {
    this.mount();
    const body = this.shadow!.querySelector('.cv-overlay-body')!;
    const progress = createProgressBar();
    body.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.className = 'cv-extracting';
    wrapper.appendChild(progress.element);
    body.appendChild(wrapper);

    const footer = this.shadow!.querySelector('.cv-overlay-footer')!;
    footer.innerHTML = `<button class="cv-btn cv-btn-ghost" data-action="cancel">Cancel</button>`;
    footer.querySelector('[data-action="cancel"]')?.addEventListener('click', onCancel);

    this.updateProgress = progress.update;
  }

  updateProgress: ((p: ExtractionProgress) => void) | null = null;

  showPreview(
    conversation: Conversation,
    options: ExportOptions,
    callbacks: OverlayCallbacks,
  ): void {
    this.mount();
    const { html } = buildExportDocument(conversation, options);

    const body = this.shadow!.querySelector('.cv-overlay-body')!;
    body.innerHTML = `<iframe class="cv-overlay-preview" sandbox="allow-same-origin"></iframe>`;
    const iframe = body.querySelector('iframe')!;
    const doc = iframe.contentDocument!;
    doc.open();
    doc.write(html);
    doc.close();

    const footer = this.shadow!.querySelector('.cv-overlay-footer')!;
    footer.innerHTML = `
      <button class="cv-btn cv-btn-ghost" data-action="cancel">Cancel</button>
      <button class="cv-btn cv-btn-secondary" data-action="download">Download PDF</button>
      <button class="cv-btn cv-btn-primary" data-action="print">Print / Save PDF</button>
    `;

    footer.querySelector('[data-action="cancel"]')?.addEventListener('click', () => callbacks.onCancel());
    footer.querySelector('[data-action="print"]')?.addEventListener('click', async () => {
      await callbacks.onPrint(conversation);
    });
    footer.querySelector('[data-action="download"]')?.addEventListener('click', async () => {
      await callbacks.onDownload(conversation);
    });

    const title = this.shadow!.querySelector('.cv-overlay-title')!;
    title.textContent = conversation.metadata.title ?? 'Chat Export';
  }

  destroy(): void {
    if (this.previouslyFocused instanceof HTMLElement) {
      this.previouslyFocused.focus();
    }
    this.host?.remove();
    this.host = null;
    this.shadow = null;
    this.abortController = null;
  }

  getAbortSignal(): AbortSignal {
    if (!this.abortController) {
      this.abortController = new AbortController();
    }
    return this.abortController.signal;
  }

  abort(): void {
    this.abortController?.abort();
  }

  private mount(): void {
    if (this.host) return;

    this.previouslyFocused = document.activeElement;

    this.host = document.createElement('div');
    this.host.id = 'chatvault-export-overlay';
    this.shadow = this.host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = OVERLAY_STYLES;

    const backdrop = document.createElement('div');
    backdrop.className = 'cv-overlay-backdrop';
    backdrop.innerHTML = `
      <div class="cv-overlay-panel" role="dialog" aria-modal="true" aria-label="ChatVault Export Preview">
        <div class="cv-overlay-header">
          <h2 class="cv-overlay-title">Exporting…</h2>
          <button class="cv-overlay-close" aria-label="Close">&times;</button>
        </div>
        <div class="cv-overlay-body"></div>
        <div class="cv-overlay-footer"></div>
      </div>
    `;

    this.shadow.append(style, backdrop);

    backdrop.querySelector('.cv-overlay-close')?.addEventListener('click', () => {
      this.abort();
      this.destroy();
    });

    document.addEventListener('keydown', this.handleKeydown);
    document.body.appendChild(this.host);
    this.trapFocus(backdrop.querySelector('.cv-overlay-panel') as HTMLElement);
  }

  private handleKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      this.abort();
      this.destroy();
      document.removeEventListener('keydown', this.handleKeydown);
    }
    if (e.key === 'Tab' && this.shadow) {
      this.handleTab(e);
    }
  };

  private trapFocus(panel: HTMLElement): void {
    this.focusableElements = Array.from(
      panel.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    );
    this.focusableElements[0]?.focus();
  }

  private handleTab(e: KeyboardEvent): void {
    if (this.focusableElements.length === 0) return;
    const first = this.focusableElements[0];
    const last = this.focusableElements[this.focusableElements.length - 1];

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
}

export async function handlePrintExport(
  conversation: Conversation,
  options: ExportOptions,
): Promise<void> {
  const { html } = buildExportDocument(conversation, options);
  await printViaIframe(html);
}

export async function handleDownloadExport(
  conversation: Conversation,
  options: ExportOptions,
): Promise<string> {
  return silentDownload(conversation, options);
}
