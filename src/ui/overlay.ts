import type { Conversation, ExportOptions, Message } from '../core/schema';
import type { ExtractionProgress } from '../core/adapter';
import { getSelectableMessages } from '../core/adapter';
import { normalizeContent, roleLabel } from '../core/normalize';
import { createProgressBar, progressStyles } from './progress';
import { buildExportDocument, silentDownload, generateFilename } from '../core/export';
import { DEFAULT_EXPORT_OPTIONS } from '../core/schema';
import { saveOptions } from '../core/storage';

export interface OverlayCallbacks {
  onDownload: (conversation: Conversation, options: ExportOptions) => Promise<void>;
  onCancel: () => void;
  onClose: () => void;
}

const A4_PREVIEW_WIDTH_PX = 794;

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
    position: relative;
    background: #fff;
    border-radius: 12px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
    width: min(1200px, 96vw);
    height: min(88vh, 900px);
    min-width: 720px;
    min-height: 480px;
    max-width: 96vw;
    max-height: 96vh;
    resize: both;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .cv-overlay-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 20px;
    border-bottom: 1px solid #e5e7eb;
    flex-shrink: 0;
  }
  .cv-overlay-header h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    color: #111827;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: calc(100% - 48px);
  }
  .cv-overlay-close {
    background: none;
    border: none;
    cursor: pointer;
    padding: 4px;
    color: #6b7280;
    font-size: 20px;
    line-height: 1;
    flex-shrink: 0;
    border-radius: 6px;
    transition: background 0.15s, color 0.15s;
  }
  .cv-overlay-close:hover {
    background: #f3f4f6;
    color: #111827;
  }
  .cv-overlay-close:active {
    background: #e5e7eb;
  }
  .cv-overlay-body {
    flex: 1;
    overflow: hidden;
    padding: 0;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .cv-selection-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 16px;
    border-bottom: 1px solid #e5e7eb;
    background: #f9fafb;
    flex-shrink: 0;
  }
  .cv-selection-count {
    font-size: 13px;
    color: #4b5563;
    font-weight: 500;
  }
  .cv-selection-actions {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .cv-selection-actions button {
    font-size: 12px;
    padding: 4px 10px;
    border-radius: 6px;
    border: 1px solid #d1d5db;
    background: #fff;
    color: #374151;
    cursor: pointer;
  }
  .cv-selection-actions button:hover {
    background: #f3f4f6;
  }
  .cv-toggle-sidebar {
    font-weight: 500;
  }
  .cv-export-options {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 16px 24px;
    padding: 10px 16px;
    border-bottom: 1px solid #e5e7eb;
    background: #fff;
    flex-shrink: 0;
  }
  .cv-export-options label {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: #374151;
    cursor: pointer;
  }
  .cv-export-options input[type="checkbox"] {
    cursor: pointer;
  }
  .cv-filename-field {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 200px;
  }
  .cv-filename-field span {
    font-size: 13px;
    color: #6b7280;
    white-space: nowrap;
  }
  .cv-filename-field input {
    flex: 1;
    min-width: 0;
    padding: 6px 10px;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    font-size: 13px;
    color: #111827;
  }
  .cv-filename-field input:focus {
    outline: none;
    border-color: #4F46E5;
    box-shadow: 0 0 0 2px rgba(79, 70, 229, 0.15);
  }
  .cv-filename-hint {
    font-size: 11px;
    color: #9ca3af;
    width: 100%;
    margin: -4px 0 0;
  }
  .cv-preview-layout {
    display: flex;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
  .cv-message-sidebar {
    width: 240px;
    flex-shrink: 0;
    border-right: 1px solid #e5e7eb;
    overflow-y: auto;
    background: #fafafa;
    transition: width 0.2s, opacity 0.2s;
  }
  .cv-message-sidebar.collapsed {
    width: 0;
    opacity: 0;
    overflow: hidden;
    border-right: none;
  }
  .cv-message-item {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 12px;
    border-bottom: 1px solid #eee;
    cursor: pointer;
    transition: background 0.1s;
  }
  .cv-message-item:hover {
    background: #f0f0f5;
  }
  .cv-message-item input {
    margin-top: 3px;
    flex-shrink: 0;
    cursor: pointer;
  }
  .cv-message-item-body {
    min-width: 0;
    flex: 1;
  }
  .cv-message-role {
    display: inline-block;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    padding: 2px 6px;
    border-radius: 4px;
    margin-bottom: 4px;
  }
  .cv-message-role-user { background: #eef2ff; color: #4F46E5; }
  .cv-message-role-assistant { background: #ecfdf5; color: #059669; }
  .cv-message-role-reasoning { background: #f3f4f6; color: #6b7280; }
  .cv-message-role-system { background: #fef3c7; color: #b45309; }
  .cv-message-preview {
    font-size: 12px;
    color: #6b7280;
    line-height: 1.4;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  .cv-preview-column {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    background: #f3f4f6;
    border-left: 1px solid #e5e7eb;
  }
  .cv-preview-viewport {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 24px;
    background: #f3f4f6;
    display: flex;
    justify-content: center;
    align-items: flex-start;
  }
  .cv-preview-scaler-wrap {
    position: relative;
    margin: 0 auto;
    flex-shrink: 0;
  }
  .cv-preview-scaler {
    transform-origin: top left;
  }
  .cv-overlay-preview {
    width: ${A4_PREVIEW_WIDTH_PX}px;
    border: 1px solid #d1d5db;
    display: block;
    background: #fff;
    overflow: hidden;
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.12);
    border-radius: 2px;
  }
  .cv-panel-resize-grip {
    position: absolute;
    right: 6px;
    bottom: 6px;
    width: 14px;
    height: 14px;
    pointer-events: none;
    opacity: 0.35;
    background:
      linear-gradient(135deg, transparent 50%, #9ca3af 50%),
      linear-gradient(135deg, transparent 65%, #9ca3af 65%);
  }
  .cv-overlay-footer {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 20px;
    border-top: 1px solid #e5e7eb;
    justify-content: flex-end;
    flex-shrink: 0;
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
  .cv-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
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
  private conversation: Conversation | null = null;
  private baseOptions: ExportOptions | null = null;
  private selectedIds = new Set<string>();
  private callbacks: OverlayCallbacks | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private sidebarCollapsed = false;
  private scalePreviewFrame: number | null = null;
  private isDestroying = false;
  private extractingCancelCallback: (() => void) | null = null;

  showExtracting(onCancel: () => void): void {
    this.mount();
    this.extractingCancelCallback = onCancel;
    const body = this.shadow!.querySelector('.cv-overlay-body')!;
    const progress = createProgressBar();
    body.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.className = 'cv-extracting';
    wrapper.appendChild(progress.element);
    body.appendChild(wrapper);

    const footer = this.shadow!.querySelector('.cv-overlay-footer')!;
    footer.innerHTML = `<button class="cv-btn cv-btn-ghost" data-action="cancel">Cancel</button>`;
    footer.querySelector('[data-action="cancel"]')?.addEventListener('click', () => this.closeOverlay());

    this.updateProgress = progress.update;
  }

  updateProgress: ((p: ExtractionProgress) => void) | null = null;

  showPreview(
    conversation: Conversation,
    options: ExportOptions,
    callbacks: OverlayCallbacks,
  ): void {
    this.mount();
    this.conversation = conversation;
    this.baseOptions = options;
    this.callbacks = callbacks;

    const selectable = getSelectableMessages(conversation.messages, options);
    this.selectedIds = new Set(selectable.map((m) => m.id));

    const body = this.shadow!.querySelector('.cv-overlay-body')!;
    body.innerHTML = `
      <div class="cv-selection-toolbar">
        <span class="cv-selection-count" data-selection-count></span>
        <div class="cv-selection-actions">
          <button type="button" class="cv-toggle-sidebar" data-action="toggle-sidebar">Hide messages</button>
          <button type="button" data-action="select-all">Select all</button>
          <button type="button" data-action="select-none">Deselect all</button>
        </div>
      </div>
      <div class="cv-export-options" data-export-options>
        <label>
          <input type="checkbox" data-opt-thinking checked />
          Include thinking/reasoning chains
        </label>
        <div class="cv-filename-field">
          <span>Filename template</span>
          <input type="text" data-opt-filename value="ChatVault_{title}" placeholder="ChatVault_{title}" />
        </div>
        <p class="cv-filename-hint" data-filename-hint></p>
      </div>
      <div class="cv-preview-layout">
        <div class="cv-message-sidebar" data-sidebar></div>
        <div class="cv-preview-column">
          <div class="cv-preview-viewport" data-preview-viewport>
            <div class="cv-preview-scaler-wrap" data-scaler-wrap>
              <div class="cv-preview-scaler" data-scaler>
                <iframe class="cv-overlay-preview" sandbox="allow-same-origin" title="PDF preview"></iframe>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    body.querySelector('[data-action="toggle-sidebar"]')?.addEventListener('click', () => {
      this.sidebarCollapsed = !this.sidebarCollapsed;
      const sidebar = this.shadow!.querySelector('.cv-message-sidebar');
      const toggleBtn = this.shadow!.querySelector('[data-action="toggle-sidebar"]');
      sidebar?.classList.toggle('collapsed', this.sidebarCollapsed);
      if (toggleBtn) {
        toggleBtn.textContent = this.sidebarCollapsed ? 'Show messages' : 'Hide messages';
      }
      requestAnimationFrame(() => this.scalePreview());
    });

    body.querySelector('[data-action="select-all"]')?.addEventListener('click', () => {
      this.selectedIds = new Set(selectable.map((m) => m.id));
      this.renderSidebar(selectable);
      this.refreshPreview();
      this.updateSelectionUi();
    });

    body.querySelector('[data-action="select-none"]')?.addEventListener('click', () => {
      this.selectedIds.clear();
      this.renderSidebar(selectable);
      this.refreshPreview();
      this.updateSelectionUi();
    });

    this.bindExportOptions(conversation);

    this.renderSidebar(selectable);
    this.refreshPreview();
    this.updateSelectionUi();
    this.setupPreviewResizeObserver();

    const footer = this.shadow!.querySelector('.cv-overlay-footer')!;
    footer.innerHTML = `
      <button class="cv-btn cv-btn-ghost" data-action="cancel">Cancel</button>
      <button class="cv-btn cv-btn-primary" data-action="download">Download PDF</button>
    `;

    footer.querySelector('[data-action="cancel"]')?.addEventListener('click', () => this.closeOverlay());
    footer.querySelector('[data-action="download"]')?.addEventListener('click', async () => {
      const opts = this.getExportOptions();
      if (!opts || !this.conversation) return;
      await callbacks.onDownload(this.conversation, opts);
    });

    const title = this.shadow!.querySelector('.cv-overlay-title')!;
    const msgCount = selectable.length;
    title.textContent = `${conversation.metadata.title ?? 'Chat Export'} · ${msgCount} messages`;

    const panel = this.shadow!.querySelector('.cv-overlay-panel') as HTMLElement;
    this.trapFocus(panel);
  }

  private bindExportOptions(conversation: Conversation): void {
    if (!this.shadow || !this.baseOptions) return;

    const thinkingInput = this.shadow.querySelector('[data-opt-thinking]') as HTMLInputElement;
    const filenameInput = this.shadow.querySelector('[data-opt-filename]') as HTMLInputElement;
    const hintEl = this.shadow.querySelector('[data-filename-hint]');

    thinkingInput.checked = this.baseOptions.includeThinking;
    filenameInput.value =
      this.baseOptions.filenameTemplate ?? DEFAULT_EXPORT_OPTIONS.filenameTemplate ?? 'ChatVault_{title}';

    const updateHint = () => {
      if (!hintEl || !this.baseOptions) return;
      const opts = this.getExportOptions() ?? this.baseOptions;
      const filename = generateFilename(conversation, opts);
      hintEl.textContent = `Preview: ${filename} · vars: {platform}, {title}, {date}, {model}, {count}`;
    };
    updateHint();

    const persistAndRefresh = async () => {
      if (!this.baseOptions || !this.conversation) return;
      this.baseOptions = {
        ...this.baseOptions,
        includeThinking: thinkingInput.checked,
        filenameTemplate: filenameInput.value || DEFAULT_EXPORT_OPTIONS.filenameTemplate,
      };
      await saveOptions(this.baseOptions);

      const selectable = getSelectableMessages(this.conversation.messages, this.baseOptions);
      this.selectedIds = new Set(
        [...this.selectedIds].filter((id) => selectable.some((m) => m.id === id)),
      );
      if (this.selectedIds.size === 0 && selectable.length > 0) {
        this.selectedIds = new Set(selectable.map((m) => m.id));
      }

      this.renderSidebar(selectable);
      this.refreshPreview();
      this.updateSelectionUi();
      updateHint();
    };

    thinkingInput.addEventListener('change', () => void persistAndRefresh());
    filenameInput.addEventListener('change', () => void persistAndRefresh());
    filenameInput.addEventListener('input', updateHint);
  }

  private getExportOptions(): ExportOptions | null {
    if (!this.baseOptions || !this.conversation) return null;
    const selectable = getSelectableMessages(this.conversation.messages, this.baseOptions);
    const allSelected =
      selectable.length > 0 && selectable.every((m) => this.selectedIds.has(m.id));

    return {
      ...this.baseOptions,
      selectedMessageIds: allSelected ? undefined : [...this.selectedIds],
    };
  }

  private renderSidebar(messages: Message[]): void {
    const sidebar = this.shadow!.querySelector('[data-sidebar]');
    if (!sidebar) return;

    sidebar.innerHTML = messages
      .map((msg) => {
        const role = msg.isThinking ? 'reasoning' : msg.role;
        const preview = escapeHtml(truncatePreview(normalizeContent(msg), 80));
        const checked = this.selectedIds.has(msg.id) ? 'checked' : '';
        return `
          <label class="cv-message-item" data-msg-id="${escapeHtml(msg.id)}">
            <input type="checkbox" ${checked} aria-label="Include message from ${escapeHtml(roleLabel(role))}" />
            <div class="cv-message-item-body">
              <span class="cv-message-role cv-message-role-${role}">${escapeHtml(roleLabel(role))}</span>
              <div class="cv-message-preview">${preview}</div>
            </div>
          </label>
        `;
      })
      .join('');

    sidebar.querySelectorAll('.cv-message-item').forEach((item) => {
      const id = item.getAttribute('data-msg-id');
      if (!id) return;

      const checkbox = item.querySelector('input[type="checkbox"]') as HTMLInputElement;
      const toggle = () => {
        if (checkbox.checked) {
          this.selectedIds.add(id);
        } else {
          this.selectedIds.delete(id);
        }
        this.refreshPreview();
        this.updateSelectionUi();
      };

      checkbox.addEventListener('change', toggle);
      item.addEventListener('click', (e) => {
        if (e.target === checkbox) return;
        e.preventDefault();
        checkbox.checked = !checkbox.checked;
        toggle();
      });
    });
  }

  private refreshPreview(): void {
    if (!this.conversation || !this.shadow) return;
    const opts = this.getExportOptions();
    if (!opts) return;

    const { html } = buildExportDocument(this.conversation, opts, 'preview');
    const iframe = this.shadow.querySelector('.cv-overlay-preview') as HTMLIFrameElement;
    if (!iframe) return;

    const doc = iframe.contentDocument;
    if (!doc) return;
    doc.open();
    doc.write(html);
    doc.close();

    iframe.onload = () => {
      requestAnimationFrame(() => this.scalePreview());
    };
    requestAnimationFrame(() => this.scalePreview());
  }

  private setupPreviewResizeObserver(): void {
    const viewport = this.shadow?.querySelector('[data-preview-viewport]') as HTMLElement;
    const panel = this.shadow?.querySelector('.cv-overlay-panel') as HTMLElement;
    if (!viewport) return;

    this.resizeObserver?.disconnect();
    this.resizeObserver = new ResizeObserver(() => {
      if (this.scalePreviewFrame !== null) {
        cancelAnimationFrame(this.scalePreviewFrame);
      }
      this.scalePreviewFrame = requestAnimationFrame(() => {
        this.scalePreviewFrame = null;
        this.scalePreview();
      });
    });
    this.resizeObserver.observe(viewport);
    if (panel) this.resizeObserver.observe(panel);
  }

  private scalePreview(): void {
    if (this.isDestroying) return;
    const viewport = this.shadow?.querySelector('[data-preview-viewport]') as HTMLElement;
    const wrap = this.shadow?.querySelector('[data-scaler-wrap]') as HTMLElement;
    const scaler = this.shadow?.querySelector('[data-scaler]') as HTMLElement;
    const iframe = this.shadow?.querySelector('.cv-overlay-preview') as HTMLIFrameElement;
    if (!viewport || !wrap || !scaler || !iframe) return;

    const doc = iframe.contentDocument;
    if (!doc?.documentElement) return;

    iframe.setAttribute('scrolling', 'no');
    iframe.style.overflow = 'hidden';

    const contentHeight = Math.max(
      doc.documentElement.scrollHeight,
      doc.body?.scrollHeight ?? 0,
    );
    iframe.style.height = `${contentHeight}px`;
    doc.documentElement.style.overflow = 'hidden';
    if (doc.body) doc.body.style.overflow = 'hidden';

    const availableWidth = viewport.clientWidth - 48;
    const scale = Math.min(1, availableWidth / A4_PREVIEW_WIDTH_PX);
    const scaledWidth = A4_PREVIEW_WIDTH_PX * scale;
    const scaledHeight = contentHeight * scale;

    scaler.style.width = `${A4_PREVIEW_WIDTH_PX}px`;
    scaler.style.height = `${contentHeight}px`;
    scaler.style.transform = `scale(${scale})`;
    scaler.style.transformOrigin = 'top left';

    wrap.style.width = `${scaledWidth}px`;
    wrap.style.height = `${scaledHeight}px`;
  }

  private updateSelectionUi(): void {
    if (!this.conversation || !this.baseOptions || !this.shadow) return;

    const selectable = getSelectableMessages(this.conversation.messages, this.baseOptions);
    const countEl = this.shadow.querySelector('[data-selection-count]');
    if (countEl) {
      countEl.textContent = `${this.selectedIds.size} of ${selectable.length} messages selected`;
    }

    const disabled = this.selectedIds.size === 0;
    this.shadow.querySelectorAll('[data-action="download"]').forEach((btn) => {
      (btn as HTMLButtonElement).disabled = disabled;
    });
  }

  closeOverlay(): void {
    if (this.isDestroying) return;
    this.isDestroying = true;

    if (this.scalePreviewFrame !== null) {
      cancelAnimationFrame(this.scalePreviewFrame);
      this.scalePreviewFrame = null;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    document.removeEventListener('keydown', this.handleKeydown);

    this.abort();

    const notify = this.callbacks?.onClose ?? this.extractingCancelCallback;
    this.destroy();
    notify?.();
  }

  destroy(): void {
    if (this.scalePreviewFrame !== null) {
      cancelAnimationFrame(this.scalePreviewFrame);
      this.scalePreviewFrame = null;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    document.removeEventListener('keydown', this.handleKeydown);
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
        <div class="cv-panel-resize-grip" aria-hidden="true"></div>
      </div>
    `;

    this.shadow.append(style, backdrop);

    backdrop.querySelector('.cv-overlay-close')?.addEventListener('click', () => {
      this.closeOverlay();
    });

    document.addEventListener('keydown', this.handleKeydown);
    document.body.appendChild(this.host);
    this.trapFocus(backdrop.querySelector('.cv-overlay-panel') as HTMLElement);
  }

  private handleKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      this.closeOverlay();
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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncatePreview(text: string, maxLen: number): string {
  const single = text.replace(/\s+/g, ' ').trim();
  if (single.length <= maxLen) return single;
  return `${single.slice(0, maxLen)}…`;
}

export async function handleDownloadExport(
  conversation: Conversation,
  options: ExportOptions,
): Promise<string> {
  return silentDownload(conversation, options);
}
