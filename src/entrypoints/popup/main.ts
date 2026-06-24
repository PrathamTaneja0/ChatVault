import type { ExportOptions } from '../../core/schema';
import { DEFAULT_EXPORT_OPTIONS } from '../../core/schema';
import type { DiagnosticsResponse, StatusResponse } from '../../core/messages';
import { loadOptions, saveOptions } from '../../core/storage';

const statusBadge = document.getElementById('status-badge')!;
const statusDetail = document.getElementById('status-detail')!;
const btnExport = document.getElementById('btn-export') as HTMLButtonElement;
const diagnosticsSection = document.getElementById('diagnostics-section')!;
const diagnosticsList = document.getElementById('diagnostics-list')!;

const optThinking = document.getElementById('opt-thinking') as HTMLInputElement;
const optCover = document.getElementById('opt-cover') as HTMLInputElement;
const optToc = document.getElementById('opt-toc') as HTMLInputElement;
const optFilename = document.getElementById('opt-filename') as HTMLInputElement;

let currentTabId: number | undefined;

async function init(): Promise<void> {
  const options = await loadOptions();
  applyOptionsToForm(options);

  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  currentTabId = tab?.id;

  if (!tab?.id) {
    setStatus(false, 'No active tab');
    return;
  }

  try {
    const status = (await browser.tabs.sendMessage(tab.id, {
      type: 'GET_STATUS',
    })) as StatusResponse;

    setStatus(status.supported, status.platformLabel ?? 'Unsupported page');

    if (status.supported) {
      btnExport.disabled = false;
      await loadDiagnostics(tab.id);
    }
  } catch {
    setStatus(false, 'Open a supported AI chat page');
  }

  bindEvents();
}

function applyOptionsToForm(options: ExportOptions): void {
  optThinking.checked = options.includeThinking;
  optCover.checked = options.coverPage;
  optToc.checked = options.tableOfContents;
  optFilename.value = options.filenameTemplate ?? DEFAULT_EXPORT_OPTIONS.filenameTemplate!;
}

function getOptionsFromForm(): ExportOptions {
  return {
    includeThinking: optThinking.checked,
    coverPage: optCover.checked,
    tableOfContents: optToc.checked,
    filenameTemplate: optFilename.value || DEFAULT_EXPORT_OPTIONS.filenameTemplate,
  };
}

function bindEvents(): void {
  const save = () => saveOptions(getOptionsFromForm());
  optThinking.addEventListener('change', save);
  optCover.addEventListener('change', save);
  optToc.addEventListener('change', save);
  optFilename.addEventListener('change', save);

  btnExport.addEventListener('click', async () => {
    if (!currentTabId) return;
    await saveOptions(getOptionsFromForm());
    await browser.tabs.sendMessage(currentTabId, { type: 'TRIGGER_EXPORT' });
    window.close();
  });
}

function setStatus(supported: boolean, detail: string): void {
  statusBadge.textContent = supported ? 'Supported' : 'Not supported';
  statusBadge.className = `status-badge ${supported ? 'supported' : 'unsupported'}`;
  statusDetail.textContent = detail;
}

async function loadDiagnostics(tabId: number): Promise<void> {
  try {
    const response = (await browser.tabs.sendMessage(tabId, {
      type: 'GET_DIAGNOSTICS',
    })) as DiagnosticsResponse;

    if (!response.diagnostics.length) return;

    diagnosticsSection.hidden = false;
    diagnosticsList.innerHTML = response.diagnostics
      .map(
        (d) =>
          `<li><span>${d.name}: <code>${d.selector}</code></span><span class="${d.found ? 'found' : 'missing'}">${d.found ? `✓ ${d.count}` : '✗'}</span></li>`,
      )
      .join('');
  } catch {
    /* diagnostics unavailable */
  }
}

init();
