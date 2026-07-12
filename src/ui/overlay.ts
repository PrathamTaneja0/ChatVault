import type { Conversation, ExportOptions, Message } from '../core/schema';
import type { ExtractionProgress } from '../core/adapter';
import { getSelectableMessages } from '../core/adapter';
import { normalizeContent, roleLabel } from '../core/normalize';
import { createProgressBar, progressStyles } from './progress';
import { buildExportDocument, buildExportJson, silentDownload } from '../core/export';
import { saveOptions } from '../core/storage';
import { escapeHtml } from '../core/html-utils';

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
    background: rgba(0, 0, 0, 0.72);
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'Inter', system-ui, sans-serif;
  }
  .cv-overlay-panel {
    position: relative;
    background: #1a1a1a;
    border-radius: 12px;
    border: 1px solid #333;
    box-shadow: 0 24px 80px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.04);
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
    color: #ececec;
  }
  .cv-overlay-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 20px;
    border-bottom: 1px solid #2a2a2a;
    background: #1e1e1e;
    flex-shrink: 0;
  }
  .cv-overlay-header h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    color: #ececec;
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
    color: #a3a3a3;
    font-size: 20px;
    line-height: 1;
    flex-shrink: 0;
    border-radius: 6px;
    transition: background 0.15s, color 0.15s;
  }
  .cv-overlay-close:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #ececec;
  }
  .cv-overlay-close:active {
    background: rgba(255, 255, 255, 0.12);
  }
  .cv-overlay-body {
    flex: 1;
    overflow: hidden;
    padding: 0;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: #1a1a1a;
  }
  .cv-selection-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 16px;
    border-bottom: 1px solid #2a2a2a;
    background: #242424;
    flex-shrink: 0;
  }
  .cv-selection-count {
    font-size: 13px;
    color: #a3a3a3;
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
    border: 1px solid #404040;
    background: #2d2d2d;
    color: #d4d4d4;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
  }
  .cv-selection-actions button:hover {
    background: #3a3a3a;
    border-color: #525252;
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
    border-bottom: 1px solid #2a2a2a;
    background: #1e1e1e;
    flex-shrink: 0;
  }
  .cv-export-options label {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: #d4d4d4;
    cursor: pointer;
  }
  .cv-export-options input[type="checkbox"] {
    cursor: pointer;
    accent-color: #6366f1;
  }
  .cv-toggle-group {
    display: flex;
    gap: 12px;
    align-items: center;
    margin-left: auto;
  }
  .cv-toggle-label {
    font-size: 11px;
    color: #737373;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-right: 2px;
  }
  .cv-view-toggle {
    display: inline-flex;
    border: 1px solid #404040;
    border-radius: 8px;
    overflow: hidden;
  }
  .cv-view-toggle button {
    font-size: 12px;
    padding: 5px 14px;
    border: none;
    background: #2d2d2d;
    color: #a3a3a3;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }
  .cv-view-toggle button.active {
    background: #6366f1;
    color: #fff;
  }
  .cv-view-toggle button:not(.active):hover {
    background: #3a3a3a;
    color: #ececec;
  }
  .cv-preview-pane {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    display: none;
  }
  .cv-preview-pane.active {
    display: flex;
    flex-direction: column;
  }
  .cv-json-viewport {
    flex: 1;
    overflow: auto;
    padding: 16px 20px;
    background: #141414;
  }
  .cv-json-view {
    margin: 0;
    font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
    font-size: 12px;
    line-height: 1.55;
    color: #d4d4d4;
    white-space: pre-wrap;
    word-break: break-word;
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
    border-right: 1px solid #2a2a2a;
    overflow-y: auto;
    background: #141414;
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
    border-bottom: 1px solid #262626;
    cursor: pointer;
    transition: background 0.1s;
  }
  .cv-message-item:hover {
    background: rgba(255, 255, 255, 0.05);
  }
  .cv-message-item input {
    margin-top: 3px;
    flex-shrink: 0;
    cursor: pointer;
    accent-color: #6366f1;
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
  .cv-message-role-user { background: rgba(99, 102, 241, 0.18); color: #a5b4fc; }
  .cv-message-role-assistant { background: rgba(16, 185, 129, 0.18); color: #6ee7b7; }
  .cv-message-role-reasoning { background: rgba(161, 161, 170, 0.12); color: #a1a1aa; }
  .cv-message-role-system { background: rgba(245, 158, 11, 0.15); color: #fbbf24; }
  .cv-message-preview {
    font-size: 12px;
    color: #737373;
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
    background: #2a2a2e;
    border-left: 1px solid #2a2a2a;
  }
  .cv-preview-viewport {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 24px;
    background: #2a2a2e;
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
    border: 1px solid #555558;
    display: block;
    background: transparent;
    overflow: hidden;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.28);
    border-radius: 2px;
  }
  .cv-panel-resize-grip {
    position: absolute;
    right: 6px;
    bottom: 6px;
    width: 14px;
    height: 14px;
    pointer-events: none;
    opacity: 0.45;
    background:
      linear-gradient(135deg, transparent 50%, #525252 50%),
      linear-gradient(135deg, transparent 65%, #525252 65%);
  }
  .cv-overlay-footer {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 20px;
    border-top: 1px solid #2a2a2a;
    background: #1e1e1e;
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
    background: #6366f1;
    color: #fff;
  }
  .cv-btn-primary:hover { background: #818cf8; }
  .cv-btn-secondary {
    background: #10b981;
    color: #fff;
  }
  .cv-btn-secondary:hover { background: #34d399; }
  .cv-btn-ghost {
    background: #2d2d2d;
    color: #d4d4d4;
    border: 1px solid #404040;
  }
  .cv-btn-ghost:hover { background: #3a3a3a; }
  .cv-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .cv-extracting {
    padding: 40px 20px;
    text-align: center;
    color: #a3a3a3;
  }
  .cv-error {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 48px 32px;
    text-align: center;
  }
  .cv-error-icon {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: rgba(239, 68, 68, 0.14);
    color: #f87171;
    font-size: 22px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .cv-error-title {
    font-size: 15px;
    font-weight: 600;
    color: #ececec;
    margin: 0;
  }
  .cv-error-message {
    font-size: 13px;
    color: #a3a3a3;
    margin: 0;
    max-width: 480px;
    line-height: 1.5;
    word-break: break-word;
  }
  .cv-source-badge {
    display: inline-block;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    padding: 2px 8px;
    border-radius: 999px;
    margin-left: 10px;
    vertical-align: middle;
  }
  .cv-source-badge-api {
    background: rgba(16, 185, 129, 0.16);
    color: #6ee7b7;
  }
  .cv-source-badge-dom {
    background: rgba(245, 158, 11, 0.16);
    color: #fbbf24;
  }
  /* Dark scrollbars matching the overlay chrome */
  .cv-overlay-panel *::-webkit-scrollbar {
    width: 10px;
    height: 10px;
  }
  .cv-overlay-panel *::-webkit-scrollbar-track {
    background: transparent;
  }
  .cv-overlay-panel *::-webkit-scrollbar-thumb {
    background: #3f3f46;
    border-radius: 6px;
    border: 2px solid #1a1a1a;
  }
  .cv-overlay-panel *::-webkit-scrollbar-thumb:hover {
    background: #52525b;
  }
  .cv-overlay-panel *::-webkit-scrollbar-corner {
    background: transparent;
  }
  .cv-overlay-panel * {
    scrollbar-width: thin;
    scrollbar-color: #3f3f46 #1a1a1a;
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
  private previewMode: 'json' | 'pdf' = 'json';

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

  showError(message: string, callbacks: { onRetry?: () => void; onClose: () => void }): void {
    this.mount();
    this.extractingCancelCallback = callbacks.onClose;

    const title = this.shadow!.querySelector('.cv-overlay-title');
    if (title) title.textContent = 'Export failed';

    const body = this.shadow!.querySelector('.cv-overlay-body')!;
    body.innerHTML = `
      <div class="cv-error" role="alert">
        <div class="cv-error-icon" aria-hidden="true">!</div>
        <p class="cv-error-title">Something went wrong</p>
        <p class="cv-error-message">${escapeHtml(message)}</p>
      </div>
    `;

    const footer = this.shadow!.querySelector('.cv-overlay-footer')!;
    footer.innerHTML = `
      ${callbacks.onRetry ? '<button class="cv-btn cv-btn-primary" data-action="retry">Try again</button>' : ''}
      <button class="cv-btn cv-btn-ghost" data-action="close">Close</button>
    `;
    footer.querySelector('[data-action="retry"]')?.addEventListener('click', () => {
      callbacks.onRetry?.();
    });
    footer.querySelector('[data-action="close"]')?.addEventListener('click', () => this.closeOverlay());
  }

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
        <div class="cv-toggle-group">
          <span class="cv-toggle-label">Theme</span>
          <div class="cv-view-toggle" role="group" aria-label="Document theme">
            <button type="button" data-doc-theme="light" class="active">Light</button>
            <button type="button" data-doc-theme="dark">Dark</button>
          </div>
          <span class="cv-toggle-label">View</span>
          <div class="cv-view-toggle" role="group" aria-label="Preview view">
            <button type="button" data-view="json" class="active">JSON</button>
            <button type="button" data-view="pdf">PDF</button>
          </div>
        </div>
      </div>
      <div class="cv-preview-layout">
        <div class="cv-message-sidebar" data-sidebar></div>
        <div class="cv-preview-column">
          <div class="cv-preview-pane active" data-json-pane>
            <div class="cv-json-viewport">
              <pre class="cv-json-view" data-json-view></pre>
            </div>
          </div>
          <div class="cv-preview-pane" data-pdf-pane>
            <div class="cv-preview-viewport" data-preview-viewport>
              <div class="cv-preview-scaler-wrap" data-scaler-wrap>
                <div class="cv-preview-scaler" data-scaler>
                  <iframe class="cv-overlay-preview" sandbox="allow-same-origin" title="PDF preview"></iframe>
                </div>
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

    this.bindExportOptions();
    this.bindThemeToggle();
    this.bindViewToggle();

    this.renderSidebar(selectable);
    this.refreshPreview();
    this.updateSelectionUi();
    this.setupPreviewResizeObserver();

    const footer = this.shadow!.querySelector('.cv-overlay-footer')!;
    footer.innerHTML = `
      <button class="cv-btn cv-btn-ghost" data-action="cancel">Cancel</button>
      <button class="cv-btn cv-btn-primary" data-action="primary">Copy</button>
    `;

    footer.querySelector('[data-action="cancel"]')?.addEventListener('click', () => this.closeOverlay());
    footer.querySelector('[data-action="primary"]')?.addEventListener('click', () => void this.handlePrimaryAction());

    this.updatePrimaryActionButton();

    const title = this.shadow!.querySelector('.cv-overlay-title')!;
    const msgCount = selectable.length;
    const source = conversation.metadata.source;
    const sourceBadge = source
      ? `<span class="cv-source-badge cv-source-badge-${source}" title="${
          source === 'api' ? 'Captured from the platform API (exact)' : 'Captured from the page DOM'
        }">${source === 'api' ? 'API' : 'Page'}</span>`
      : '';
    title.innerHTML = `${escapeHtml(conversation.metadata.title ?? 'Chat Export')} · ${msgCount} messages${sourceBadge}`;

    const panel = this.shadow!.querySelector('.cv-overlay-panel') as HTMLElement;
    this.trapFocus(panel);
  }

  private bindThemeToggle(): void {
    if (!this.shadow) return;

    const applyActive = (): void => {
      const theme = this.baseOptions?.theme ?? 'light';
      this.shadow!.querySelectorAll('[data-doc-theme]').forEach((b) => {
        b.classList.toggle('active', b.getAttribute('data-doc-theme') === theme);
      });
    };
    applyActive();

    this.shadow.querySelectorAll('[data-doc-theme]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const theme = btn.getAttribute('data-doc-theme') as 'light' | 'dark' | null;
        if (!theme || !this.baseOptions || theme === this.baseOptions.theme) return;
        this.baseOptions = { ...this.baseOptions, theme };
        void saveOptions(this.baseOptions);
        applyActive();
        this.refreshPreview();
      });
    });
  }

  private bindViewToggle(): void {
    if (!this.shadow) return;

    this.shadow.querySelectorAll('.cv-view-toggle [data-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = btn.getAttribute('data-view') as 'json' | 'pdf';
        if (!mode || mode === this.previewMode) return;
        this.previewMode = mode;
        this.shadow!.querySelectorAll('.cv-view-toggle [data-view]').forEach((b) => {
          b.classList.toggle('active', b.getAttribute('data-view') === mode);
        });
        this.shadow!.querySelector('[data-json-pane]')?.classList.toggle('active', mode === 'json');
        this.shadow!.querySelector('[data-pdf-pane]')?.classList.toggle('active', mode === 'pdf');
        this.updatePrimaryActionButton();
        this.refreshPreview();
      });
    });
  }

  private async handlePrimaryAction(): Promise<void> {
    const opts = this.getExportOptions();
    if (!opts || !this.conversation || !this.callbacks) return;

    if (this.previewMode === 'json') {
      const json = buildExportJson(this.conversation, opts);
      await navigator.clipboard.writeText(json);
      const btn = this.shadow?.querySelector('[data-action="primary"]') as HTMLButtonElement;
      if (btn) {
        const original = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => {
          if (btn.isConnected) btn.textContent = original;
        }, 1500);
      }
      return;
    }

    await this.callbacks.onDownload(this.conversation, opts);
  }

  private updatePrimaryActionButton(): void {
    const btn = this.shadow?.querySelector('[data-action="primary"]') as HTMLButtonElement;
    if (btn) {
      btn.textContent = this.previewMode === 'json' ? 'Copy' : 'Download PDF';
    }
  }

  private bindExportOptions(): void {
    if (!this.shadow || !this.baseOptions) return;

    const thinkingInput = this.shadow.querySelector('[data-opt-thinking]') as HTMLInputElement;
    thinkingInput.checked = this.baseOptions.includeThinking;

    const persistAndRefresh = async () => {
      if (!this.baseOptions || !this.conversation) return;
      this.baseOptions = {
        ...this.baseOptions,
        includeThinking: thinkingInput.checked,
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
    };

    thinkingInput.addEventListener('change', () => void persistAndRefresh());
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
    if (this.previewMode === 'json') {
      this.refreshJsonView();
    } else {
      this.refreshPdfView();
    }
  }

  private refreshJsonView(): void {
    if (!this.conversation || !this.shadow) return;
    const opts = this.getExportOptions();
    if (!opts) return;

    const jsonView = this.shadow.querySelector('[data-json-view]');
    if (jsonView) {
      jsonView.textContent = buildExportJson(this.conversation, opts);
    }
  }

  private refreshPdfView(): void {
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
    if (this.isDestroying || this.previewMode !== 'pdf') return;
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
    this.shadow.querySelectorAll('[data-action="primary"]').forEach((btn) => {
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
    // Ignore synthetic Escape from hydration (used to dismiss Claude paste viewers)
    if (e.key === 'Escape' && e.isTrusted) {
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
