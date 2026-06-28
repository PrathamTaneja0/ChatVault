import type { ProgressCallback } from '../core/adapter';
import { isArtifactLabelOnly, sleep, sortElementsByDomOrder } from '../core/extract-utils';
import { fetchArtifactViaWiggleApi, resetClaudeWiggleCache } from './claude-wiggle';

const HYDRATE_POLL_MS = [150, 200, 250, 300, 350, 400, 450, 500];
const PASTE_HYDRATE_POLL_MS = [150, 200, 250, 300, 400, 500, 600, 800, 1000, 1200];
const MIN_PASTE_BODY_LEN = 400;
const MIN_ARTIFACT_BODY_LEN = 100;

const PASTE_PANEL_TITLE = 'pasted content';
const PASTE_PANEL_METADATA_HINTS = ['lines', 'formatting may be inconsistent'];

const PASTE_PANEL_ROOT_SELECTORS = [
  '[data-testid="paste-content-panel"]',
  '[data-testid*="paste-content"]',
  '[data-testid*="paste-panel"]',
  '[role="dialog"]',
  '[class*="paste-panel"]',
  '[class*="PastePanel"]',
  '[class*="drawer"]',
  '[class*="overlay"]',
];

const PASTE_BODY_SELECTORS = [
  '[class*="font-mono"]',
  'pre',
  'code',
  '[class*="whitespace-pre"]',
  '[class*="break-words"]',
];

const ARTIFACT_PANEL_SELECTORS = [
  '[class*="artifact-view"]',
  '[class*="ArtifactView"]',
  'aside[class*="split-view"]',
  'aside[class*="artifact"]',
  '.artifact-panel',
  '[class*="split-view"]',
  'div[class*="split-view"]',
];

const PANEL_CONTENT_SELECTORS = ['.standard-markdown', '.progressive-markdown', 'pre'];

const ARTIFACT_BODY_SELECTORS = [
  ...PANEL_CONTENT_SELECTORS,
  ...PASTE_BODY_SELECTORS,
];

const PAGE_FETCH_CAPTURE_ATTR = 'data-chatvault-fetch-capture';
const PAGE_DOWNLOAD_BLOCK_ATTR = 'data-chatvault-download-block';
const DOWNLOAD_FILE_EVENT = 'chatvault-download-file';

export function normalizeCacheKey(key: string): string {
  return key.replace(/\s+/g, ' ').trim().toLowerCase();
}

export function cacheKeyForPaste(ariaLabel: string): string {
  return normalizeCacheKey(ariaLabel || 'pasted content');
}

export function cacheKeyForArtifact(title: string): string {
  return normalizeCacheKey(
    title.replace(/Document\s*·.*$/i, '').replace(/Spreadsheet\s*·.*$/i, '').trim(),
  );
}

export class HydratedContentCache {
  private readonly map = new Map<string, string>();

  set(key: string, content: string): void {
    const normalized = content.trim();
    if (!normalized) return;
    this.map.set(normalizeCacheKey(key), normalized);
  }

  get(key: string): string | undefined {
    return this.map.get(normalizeCacheKey(key));
  }

  /** Match partial keys (e.g. title contained in aria-label). */
  getFuzzy(key: string): string | undefined {
    const norm = normalizeCacheKey(key);
    if (!norm) return undefined;
    const direct = this.map.get(norm);
    if (direct) return direct;
    for (const [k, v] of this.map) {
      if (k.includes(norm) || norm.includes(k)) return v;
    }
    return undefined;
  }

  /** True when content duplicates another cached entry (e.g. paste on clipboard during artifact copy). */
  contentMatchesCachedEntry(content: string, exceptKeys: string[] = [], minLength = 100): boolean {
    const normalized = content.replace(/\s+/g, ' ').trim().toLowerCase();
    if (!normalized || normalized.length < minLength) return false;

    const except = new Set(exceptKeys.map((key) => normalizeCacheKey(key)));

    for (const [k, v] of this.map) {
      if (except.has(k)) continue;
      const cachedNorm = v.replace(/\s+/g, ' ').trim().toLowerCase();
      if (!cachedNorm || cachedNorm.length < minLength) continue;
      if (normalized === cachedNorm) return true;
      const shorter = Math.min(normalized.length, cachedNorm.length);
      const longer = Math.max(normalized.length, cachedNorm.length);
      if (shorter / longer < 0.85) continue;
      if (normalized.includes(cachedNorm) || cachedNorm.includes(normalized)) return true;
    }

    return false;
  }
}

function normalizePanelText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

function elementHasPastePanelTitle(el: Element): boolean {
  for (const node of el.querySelectorAll('h1, h2, h3, h4, [role="heading"], span, div, p')) {
    const text = node.textContent?.trim() ?? '';
    if (text.length > 80) continue;
    if (normalizePanelText(text) === PASTE_PANEL_TITLE) return true;
  }
  return false;
}

function elementHasPastePanelMetadata(el: Element): boolean {
  const combined = normalizePanelText(el.textContent ?? '');
  return PASTE_PANEL_METADATA_HINTS.every((hint) => combined.includes(hint));
}

function isArtifactPanelElement(el: Element): boolean {
  for (const sel of ARTIFACT_PANEL_SELECTORS) {
    if (el.matches(sel)) return true;
  }
  const text = el.textContent ?? '';
  if (/Document\s*·/i.test(text) || /Spreadsheet\s*·/i.test(text)) return true;
  if (el.querySelector('.standard-markdown, .progressive-markdown') && !elementHasPastePanelTitle(el)) {
    return el.matches('[class*="split-view"], aside[class*="artifact"], .artifact-panel');
  }
  return false;
}

export function isPasteContentPanel(el: Element): boolean {
  if (el.closest('.font-claude-response, [data-testid="user-message"]')) return false;
  if (isArtifactPanelElement(el)) return false;
  if (elementHasPastePanelTitle(el)) return true;
  if (elementHasPastePanelMetadata(el) && el.querySelector('button[aria-label*="Copy"], button[aria-label*="copy"]')) {
    return true;
  }
  return false;
}

function findPasteTitleNode(document: Document): Element | null {
  for (const node of document.querySelectorAll('h1, h2, h3, h4, [role="heading"]')) {
    const text = node.textContent?.trim() ?? '';
    if (text.length > 80) continue;
    if (normalizePanelText(text) === PASTE_PANEL_TITLE) return node;
  }
  return null;
}

function hasPastePanelCopyButton(el: Element): boolean {
  return !!el.querySelector(
    'button[aria-label*="Copy"]:not([data-testid="action-bar-copy"]), button[aria-label*="copy"]:not([data-testid="action-bar-copy"])',
  );
}

function measurePasteBodyLength(container: Element, titleNode?: Element | null): number {
  const headerRoot = titleNode ? getPastePanelHeaderRootFromTitle(container, titleNode) : getPastePanelHeaderRoot(container);
  let best = 0;

  for (const sel of PASTE_BODY_SELECTORS) {
    for (const node of container.querySelectorAll(sel)) {
      if (node.closest('.font-claude-response, [data-testid="user-message"]')) continue;
      if (headerRoot?.contains(node)) continue;
      const text = node.textContent?.trim() ?? '';
      if (text.length > best && !isArtifactLabelOnly(text)) best = text.length;
    }
  }

  if (best >= MIN_PASTE_BODY_LEN) return best;

  for (const node of container.querySelectorAll('div, pre, code')) {
    if (node.closest('.font-claude-response, [data-testid="user-message"]')) continue;
    if (headerRoot?.contains(node)) continue;
    if (node.querySelector(PASTE_BODY_SELECTORS.join(','))) continue;
    const text = node.textContent?.trim() ?? '';
    if (text.length > best && !isArtifactLabelOnly(text)) best = text.length;
  }

  return best;
}

/** Live Claude: panel is generic divs — climb from h2 until Copy + body both present. */
export function climbToPastePanelRoot(titleNode: Element): Element | null {
  let current: Element | null = titleNode;

  while (current && current !== document.body) {
    if (
      hasPastePanelCopyButton(current) &&
      measurePasteBodyLength(current, titleNode) >= MIN_PASTE_BODY_LEN
    ) {
      return current;
    }
    current = current.parentElement;
  }

  return null;
}

function climbToPanelRoot(el: Element): Element {
  const titleText = el.textContent?.trim() ?? '';
  if (normalizePanelText(titleText) === PASTE_PANEL_TITLE) {
    const pasteRoot = climbToPastePanelRoot(el);
    if (pasteRoot) return pasteRoot;
  }

  let current: Element | null = el;
  let best = el;
  while (current && current !== document.body) {
    if (
      current.matches(
        '[role="dialog"], aside, nav, [data-testid*="paste"], [class*="panel"], [class*="drawer"], [class*="overlay"]',
      )
    ) {
      best = current;
    }
    current = current.parentElement;
  }
  return best;
}

export function findPasteContentPanel(document: Document): Element | null {
  const titleNode = findPasteTitleNode(document);
  if (titleNode) {
    const panel = climbToPastePanelRoot(titleNode);
    if (panel && !panel.closest('.font-claude-response, [data-testid="user-message"]')) {
      if (!isArtifactPanelElement(panel)) return panel;
    }
  }

  for (const sel of PASTE_PANEL_ROOT_SELECTORS) {
    for (const candidate of document.querySelectorAll(sel)) {
      if (candidate.closest('.font-claude-response, [data-testid="user-message"]')) continue;
      if (!isPasteContentPanel(candidate)) continue;
      const panel = climbToPanelRoot(candidate);
      if (isPasteContentPanel(panel) && isPanelVisible(panel)) return panel;
    }
  }

  if (titleNode) {
    const panel = climbToPanelRoot(titleNode);
    if (panel.closest('.font-claude-response, [data-testid="user-message"]')) return null;
    if (isArtifactPanelElement(panel)) return null;
    if (isPanelVisible(panel)) return panel;
  }

  return null;
}

function getPastePanelHeaderRootFromTitle(panel: Element, titleNode: Element): Element | null {
  let header: Element | null = titleNode;
  for (let i = 0; i < 4 && header?.parentElement && header.parentElement !== panel; i++) {
    header = header.parentElement;
  }
  return header ?? titleNode;
}

function getPastePanelHeaderRoot(panel: Element): Element | null {
  for (const node of panel.querySelectorAll('h1, h2, h3, h4, [role="heading"], span, div, p')) {
    const text = node.textContent?.trim() ?? '';
    if (normalizePanelText(text) === PASTE_PANEL_TITLE) {
      let header: Element | null = node;
      for (let i = 0; i < 4 && header?.parentElement && header.parentElement !== panel; i++) {
        header = header.parentElement;
      }
      return header ?? node;
    }
  }
  return null;
}

export function readPastePanelDom(panel: Element): string {
  const headerRoot = getPastePanelHeaderRoot(panel);
  let best = '';

  for (const sel of PASTE_BODY_SELECTORS) {
    for (const node of panel.querySelectorAll(sel)) {
      if (node.closest('.font-claude-response, [data-testid="user-message"]')) continue;
      if (headerRoot?.contains(node)) continue;
      const text = node.textContent?.trim() ?? '';
      if (text.length >= MIN_PASTE_BODY_LEN && !isArtifactLabelOnly(text) && text.length > best.length) {
        best = text;
      }
    }
  }

  if (best.length >= MIN_PASTE_BODY_LEN) return best;

  for (const node of panel.querySelectorAll('div, pre, code')) {
    if (node.closest('.font-claude-response, [data-testid="user-message"]')) continue;
    if (headerRoot?.contains(node)) continue;
    if (node.querySelector(PASTE_BODY_SELECTORS.join(','))) continue;
    const text = node.textContent?.trim() ?? '';
    if (text.length >= MIN_PASTE_BODY_LEN && !isArtifactLabelOnly(text) && text.length > best.length) {
      best = text;
    }
  }

  return best;
}

export function findPastePanelCopyButton(panel: Element): HTMLElement | null {
  const headerRoot = getPastePanelHeaderRoot(panel);
  const searchRoots: Element[] = headerRoot ? [headerRoot, panel] : [panel];

  for (const root of searchRoots) {
    for (const btn of root.querySelectorAll('button[aria-label*="Copy"], button[aria-label*="copy"]')) {
      if (!(btn instanceof HTMLElement)) continue;
      if (btn.matches('[data-testid="action-bar-copy"]')) continue;
      if (btn.closest('.font-claude-response, [data-testid="user-message"]')) continue;
      return btn;
    }
  }

  return null;
}

export async function readPastePanelViaCopy(
  panel: Element | null,
  signal?: AbortSignal,
): Promise<string> {
  if (!panel) return '';
  const copyBtn = findPastePanelCopyButton(panel);
  if (!copyBtn) return '';

  copyBtn.click();
  await sleep(200, signal);
  try {
    const readText = navigator.clipboard?.readText?.bind(navigator.clipboard);
    if (!readText) return '';
    const clip = await readText();
    if (clip.trim().length >= MIN_PASTE_BODY_LEN && !isArtifactLabelOnly(clip.trim())) {
      return clip.trim();
    }
  } catch {
    /* clipboardRead may be unavailable */
  }
  return '';
}

export async function dismissPasteContentPanel(
  document: Document,
  signal?: AbortSignal,
): Promise<void> {
  const panel = findPasteContentPanel(document);
  if (!panel) return;

  const dismissSelectors = [
    'button[aria-label="Close"]',
    'button[aria-label*="Close"]',
    'button[aria-label*="Back"]',
    'button[aria-label*="back"]',
  ];

  for (const sel of dismissSelectors) {
    const btn = panel.querySelector(sel);
    if (btn instanceof HTMLElement) {
      btn.click();
      await sleep(150, signal);
      return;
    }
  }
}

export function isClaudeSidePanel(el: Element): boolean {
  if (el.closest('[class*="split-view"], aside[class*="artifact"], .artifact-panel, [class*="artifact-view"]')) {
    return true;
  }
  if (isPasteContentPanel(el)) return true;
  if (el.closest('[class*="z-20"]') && !el.closest('[data-test-render-count]')) return true;
  return false;
}

/** True for user/assistant turns in the chat stream, not side-panel overlays. */
export function isClaudeChatStreamTurn(el: Element): boolean {
  if (isClaudeSidePanel(el)) return false;
  if (el.closest('[data-test-render-count]')) return true;
  if (el.matches('[data-testid="user-message"]') && el.closest('main')) return true;
  if (el.matches('.font-claude-response') && el.closest('main')) return true;
  return false;
}

export async function dismissArtifactPanel(
  document: Document,
  signal?: AbortSignal,
): Promise<void> {
  const panel = findArtifactPanel(document);
  if (!panel) return;

  const dismissSelectors = [
    'button[aria-label="Close"]',
    'button[aria-label*="Close"]',
    'button[aria-label*="Back"]',
    'button[aria-label*="back"]',
  ];

  for (const sel of dismissSelectors) {
    const btn = panel.querySelector(sel);
    if (btn instanceof HTMLElement) {
      btn.click();
      await sleep(150, signal);
      return;
    }
  }
}

export function isPanelVisible(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.getAttribute('aria-hidden') === 'true') return false;
  if (el.hasAttribute('inert')) return false;
  const style = el.ownerDocument.defaultView?.getComputedStyle(el);
  if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width > 40 && rect.height > 40) return true;
  // jsdom and collapsed split panes may report zero size while content is readable
  const artifactText = readArtifactPanelDom(el);
  if (artifactText.length > MIN_ARTIFACT_BODY_LEN) return true;
  const pasteText = readPastePanelDom(el);
  if (pasteText.length >= MIN_PASTE_BODY_LEN) return true;
  if (
    el.querySelector('button[aria-label*="Copy"], button[aria-label*="copy"]') &&
    el.getAttribute('aria-hidden') !== 'true'
  ) {
    return true;
  }
  return false;
}

const ARTIFACT_HEADER_STOP_SELECTORS = [
  '.standard-markdown',
  '.progressive-markdown',
  'pre',
  '[class*="font-mono"]',
];

function climbArtifactHeaderFromTitle(titleNode: Element, panel: Element): Element {
  let header: Element | null = titleNode;

  for (let i = 0; i < 4 && header?.parentElement && header.parentElement !== panel; i++) {
    const parent = header.parentElement;
    if (ARTIFACT_HEADER_STOP_SELECTORS.some((sel) => parent.matches(sel))) break;
    header = parent;
  }

  return header ?? titleNode;
}

function getArtifactPanelHeaderRoot(panel: Element, titleNode?: Element | null): Element | null {
  if (titleNode && panel.contains(titleNode)) {
    return climbArtifactHeaderFromTitle(titleNode, panel);
  }

  for (const node of panel.querySelectorAll('h1, h2, h3, h4, [role="heading"]')) {
    const text = node.textContent?.trim() ?? '';
    if (text.length > 80) continue;
    if (normalizePanelText(text) === PASTE_PANEL_TITLE) continue;
    return climbArtifactHeaderFromTitle(node, panel);
  }

  return null;
}

function measureArtifactBodyLength(container: Element, titleNode?: Element | null): number {
  const headerRoot = getArtifactPanelHeaderRoot(container, titleNode);
  let best = 0;

  for (const sel of ARTIFACT_BODY_SELECTORS) {
    for (const node of container.querySelectorAll(sel)) {
      if (node.closest('.font-claude-response, [data-testid="user-message"]')) continue;
      if (headerRoot?.contains(node)) continue;
      const text = node.textContent?.trim() ?? '';
      if (text.length > best && !isArtifactLabelOnly(text)) best = text.length;
    }
  }

  if (best >= MIN_ARTIFACT_BODY_LEN) return best;

  for (const node of container.querySelectorAll('div, pre, code')) {
    if (node.closest('.font-claude-response, [data-testid="user-message"]')) continue;
    if (headerRoot?.contains(node)) continue;
    if (node.querySelector(ARTIFACT_BODY_SELECTORS.join(','))) continue;
    const text = node.textContent?.trim() ?? '';
    if (text.length > best && !isArtifactLabelOnly(text)) best = text.length;
  }

  return best;
}

function climbToArtifactPanelRoot(titleNode: Element): Element | null {
  let current: Element | null = titleNode;

  while (current && current !== document.body) {
    if (
      hasPastePanelCopyButton(current) &&
      measureArtifactBodyLength(current, titleNode) >= MIN_ARTIFACT_BODY_LEN
    ) {
      return current;
    }
    current = current.parentElement;
  }

  return null;
}

/** Find artifact panel by document title (live Claude uses generic div stacks). */
export function findArtifactTitleNode(document: Document, title?: string): Element | null {
  if (!title) return null;
  const normTitle = normalizeCacheKey(
    title.replace(/Document\s*·.*$/i, '').replace(/Spreadsheet\s*·.*$/i, '').trim(),
  );
  if (!normTitle) return null;

  for (const node of document.querySelectorAll('h1, h2, h3, h4, [role="heading"]')) {
    const text = normalizeCacheKey(node.textContent?.trim() ?? '');
    if (!text || text.length > 120) continue;
    if (text !== normTitle && !text.includes(normTitle) && !normTitle.includes(text)) continue;
    if (node.closest('.font-claude-response, [data-testid="user-message"]')) continue;
    return node;
  }

  return null;
}

/** Find artifact panel by document title (live Claude uses generic div stacks). */
export function findArtifactPanelForTitle(document: Document, title?: string): Element | null {
  const titleNode = title ? findArtifactTitleNode(document, title) : null;
  if (titleNode) {
    const panel = climbToArtifactPanelRoot(titleNode);
    if (panel && !isPasteContentPanel(panel)) return panel;
  }

  if (title) {
    const normTitle = normalizeCacheKey(
      title.replace(/Document\s*·.*$/i, '').replace(/Spreadsheet\s*·.*$/i, '').trim(),
    );
    if (normTitle) {
      for (const node of document.querySelectorAll('h1, h2, h3, h4, [role="heading"]')) {
        const text = normalizeCacheKey(node.textContent?.trim() ?? '');
        if (!text || text.length > 120) continue;
        if (text !== normTitle && !text.includes(normTitle) && !normTitle.includes(text)) continue;
        if (node.closest('.font-claude-response, [data-testid="user-message"]')) continue;
        const panel = climbToArtifactPanelRoot(node);
        if (panel && !isPasteContentPanel(panel)) return panel;
      }
    }
  }

  for (const sel of ARTIFACT_PANEL_SELECTORS) {
    for (const panel of document.querySelectorAll(sel)) {
      if (panel.closest('.font-claude-response, [data-testid="user-message"]')) continue;
      if (isPasteContentPanel(panel)) continue;
      if (
        hasPastePanelCopyButton(panel) &&
        readArtifactPanelDom(panel).length >= MIN_ARTIFACT_BODY_LEN
      ) {
        return panel;
      }
    }
  }

  for (const panel of document.querySelectorAll('div.flex, aside, [role="dialog"]')) {
    if (panel.closest('.font-claude-response, [data-testid="user-message"], [data-test-render-count]')) {
      continue;
    }
    if (isPasteContentPanel(panel)) continue;
    if (
      hasPastePanelCopyButton(panel) &&
      readArtifactPanelDom(panel).length >= MIN_ARTIFACT_BODY_LEN &&
      !elementHasPastePanelTitle(panel)
    ) {
      return panel;
    }
  }

  return null;
}

export function findArtifactPanel(document: Document): Element | null {
  const byContent = findArtifactPanelForTitle(document);
  if (byContent) return byContent;

  const pastePanel = findPasteContentPanel(document);

  for (const sel of ARTIFACT_PANEL_SELECTORS) {
    for (const panel of document.querySelectorAll(sel)) {
      if (panel.closest('.font-claude-response, [data-testid="user-message"]')) continue;
      if (pastePanel && (panel === pastePanel || pastePanel.contains(panel) || panel.contains(pastePanel))) {
        continue;
      }
      if (isPasteContentPanel(panel)) continue;
      if (isPanelVisible(panel)) return panel;
    }
  }
  return null;
}

export function findPanelCopyButton(panel: Element, titleNode?: Element | null): HTMLElement | null {
  const headerRoot = getArtifactPanelHeaderRoot(panel, titleNode);
  const searchRoots: Element[] = headerRoot ? [headerRoot, panel] : [panel];

  for (const root of searchRoots) {
    for (const btn of root.querySelectorAll('button[aria-label*="Copy"], button[aria-label*="copy"]')) {
      if (!(btn instanceof HTMLElement)) continue;
      if (btn.matches('[data-testid="action-bar-copy"]')) continue;
      if (btn.closest('.font-claude-response, [data-testid="user-message"]')) continue;
      return btn;
    }
  }

  for (const btn of panel.querySelectorAll('button[aria-label*="Copy"], button[aria-label*="copy"]')) {
    if (!(btn instanceof HTMLElement)) continue;
    if (btn.matches('[data-testid="action-bar-copy"]')) continue;
    if (btn.closest('.font-claude-response, [data-testid="user-message"]')) continue;
    return btn;
  }

  return null;
}

/** Read artifact side-panel body (live Claude uses generic div stacks like paste panels). */
export function readArtifactPanelDom(panel: Element, titleNode?: Element | null): string {
  const headerRoot = getArtifactPanelHeaderRoot(panel, titleNode);
  let best = '';

  for (const sel of ARTIFACT_BODY_SELECTORS) {
    for (const node of panel.querySelectorAll(sel)) {
      if (node.closest('.font-claude-response, [data-testid="user-message"]')) continue;
      if (headerRoot?.contains(node)) continue;
      const text = node.textContent?.trim() ?? '';
      if (
        text.length >= MIN_ARTIFACT_BODY_LEN &&
        !isArtifactLabelOnly(text) &&
        text.length > best.length
      ) {
        best = text;
      }
    }
  }

  if (best.length >= MIN_ARTIFACT_BODY_LEN) return best;

  for (const node of panel.querySelectorAll('div, pre, code')) {
    if (node.closest('.font-claude-response, [data-testid="user-message"]')) continue;
    if (headerRoot?.contains(node)) continue;
    if (node.querySelector(ARTIFACT_BODY_SELECTORS.join(','))) continue;
    const text = node.textContent?.trim() ?? '';
    if (
      text.length >= MIN_ARTIFACT_BODY_LEN &&
      !isArtifactLabelOnly(text) &&
      text.length > best.length
    ) {
      best = text;
    }
  }

  return best;
}

export async function readPanelViaCopy(
  panel: Element | null,
  signal?: AbortSignal,
  titleNode?: Element | null,
): Promise<string> {
  if (!panel) return '';
  const copyBtn = findPanelCopyButton(panel, titleNode);
  if (!copyBtn) return '';

  copyBtn.click();
  await sleep(200, signal);
  try {
    const readText = navigator.clipboard?.readText?.bind(navigator.clipboard);
    if (!readText) return '';
    const clip = await readText();
    if (clip.trim().length > MIN_ARTIFACT_BODY_LEN && !isArtifactLabelOnly(clip.trim())) {
      return clip.trim();
    }
  } catch {
    /* clipboardRead may be unavailable */
  }
  return '';
}

export async function fetchClaudeDownloadFile(pathOrUrl: string): Promise<string> {
  const url = pathOrUrl.startsWith('http')
    ? pathOrUrl
    : new URL(pathOrUrl, window.location.origin).href;
  try {
    const response = await fetch(url, { credentials: 'include' });
    if (!response.ok) return '';
    const text = await response.text();
    return text.trim().length > MIN_ARTIFACT_BODY_LEN ? text.trim() : '';
  } catch {
    return '';
  }
}

function isDownloadFileUrl(url: string): boolean {
  return url.includes('download-file');
}

function normalizeDownloadFileUrl(href: string): string | undefined {
  if (!href || href.startsWith('blob:') || href.startsWith('javascript:')) return undefined;
  try {
    const url = href.startsWith('http') ? href : new URL(href, window.location.origin).href;
    return isDownloadFileUrl(url) ? url : undefined;
  } catch {
    return undefined;
  }
}

/** Look for a Claude download-file URL on/near the artifact download control. */
export function findDownloadFileUrlNearButton(button: HTMLElement): string | undefined {
  const roots = [button, button.closest('[class*="artifact"]'), button.closest('[data-testid="artifact-card"]')];
  for (const root of roots) {
    if (!(root instanceof HTMLElement)) continue;
    for (const attr of ['data-url', 'data-href', 'data-download-url', 'href']) {
      const value = root.getAttribute(attr);
      const url = value ? normalizeDownloadFileUrl(value) : undefined;
      if (url) return url;
    }
    for (const anchor of root.querySelectorAll('a[href*="download-file"]')) {
      if (anchor instanceof HTMLAnchorElement) {
        const url = normalizeDownloadFileUrl(anchor.href);
        if (url) return url;
      }
    }
  }
  return undefined;
}

function installPageWorldDownloadBlocker(): void {
  const root = document.documentElement;
  if (root.getAttribute(PAGE_DOWNLOAD_BLOCK_ATTR) === '1') return;
  root.setAttribute(PAGE_DOWNLOAD_BLOCK_ATTR, '1');

  const script = document.createElement('script');
  script.textContent = `
(function() {
  if (window.__chatVaultDownloadBlockInstalled) return;
  window.__chatVaultDownloadBlockInstalled = true;

  var origAnchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function() {
    if (this.hasAttribute('download') || (this.href && this.href.indexOf('blob:') === 0)) return;
    return origAnchorClick.call(this);
  };

  document.addEventListener('click', function(event) {
    var node = event.target;
    while (node) {
      if (node.tagName === 'A') {
        var href = node.href || '';
        if (node.hasAttribute('download') || href.indexOf('blob:') === 0) {
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
      }
      node = node.parentElement;
    }
  }, true);
})();
  `.trim();
  (document.head || document.documentElement).appendChild(script);
  script.remove();
}

function installNativeDownloadBlocker(): () => void {
  installPageWorldDownloadBlocker();
  return () => {};
}

/**
 * Last-resort artifact fetch: wiggle API, then intercepted network capture.
 * Never triggers a browser save dialog.
 */
export async function fetchArtifactContentFallback(
  title: string,
  downloadBtn: HTMLElement | null,
  capture: DownloadFileCapture,
  signal?: AbortSignal,
): Promise<string> {
  const fromWiggle = await fetchArtifactViaWiggleApi(title, signal);
  if (fromWiggle.length >= MIN_ARTIFACT_BODY_LEN) return fromWiggle;

  const fromCapture = await fetchDownloadAfterClick(capture, signal);
  if (fromCapture.length >= MIN_ARTIFACT_BODY_LEN) return fromCapture;

  if (downloadBtn) {
    const knownUrl = findDownloadFileUrlNearButton(downloadBtn);
    if (knownUrl) {
      const direct = await fetchClaudeDownloadFile(knownUrl);
      if (direct.length >= MIN_ARTIFACT_BODY_LEN) return direct;
    }
  }

  if (!downloadBtn) return '';

  const restoreDownloads = installNativeDownloadBlocker();
  const preventNativeClick = (event: Event): void => {
    event.preventDefault();
  };

  try {
    downloadBtn.addEventListener('click', preventNativeClick, true);
    downloadBtn.click();
    downloadBtn.removeEventListener('click', preventNativeClick, true);
    await sleep(300, signal);
    return await fetchDownloadAfterClick(capture, signal);
  } finally {
    restoreDownloads();
  }
}

/** @deprecated Use fetchArtifactContentFallback */
export const fetchArtifactViaDownloadButton = fetchArtifactContentFallback;

export interface DownloadFileCapture {
  install(): void;
  uninstall(): void;
  getBody(url: string): string | undefined;
  getLatestUrl(): string | undefined;
  getLatestBody(): string | undefined;
}

function installPageWorldFetchCapture(eventName: string): void {
  const root = document.documentElement;
  if (root.getAttribute(PAGE_FETCH_CAPTURE_ATTR) === eventName) return;
  root.setAttribute(PAGE_FETCH_CAPTURE_ATTR, eventName);

  const script = document.createElement('script');
  script.textContent = `
(function() {
  if (window.__chatVaultDownloadCaptureInstalled) return;
  if (!window.fetch) return;
  window.__chatVaultDownloadCaptureInstalled = true;
  var orig = window.fetch.bind(window);
  window.fetch = function() {
    var args = arguments;
    var input = args[0];
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    return orig.apply(window, args).then(function(res) {
      if (url.indexOf('download-file') !== -1) {
        try {
          var clone = res.clone();
          clone.text().then(function(text) {
            if (text && text.trim()) {
              document.dispatchEvent(new CustomEvent('${eventName}', {
                detail: { url: url, body: text.trim() }
              }));
            }
          }).catch(function() {});
        } catch (e) {}
      }
      return res;
    });
  };
})();
  `.trim();
  (document.head || document.documentElement).appendChild(script);
  script.remove();
}

export function getLatestDownloadFileUrlFromPerformance(): string | undefined {
  const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].name.includes('download-file')) return entries[i].name;
  }
  return undefined;
}

export async function waitForDownloadFileUrl(
  signal?: AbortSignal,
  pollMs: number[] = [100, 200, 300, 500, 800],
): Promise<string | undefined> {
  for (const ms of pollMs) {
    await sleep(ms, signal);
    const url = getLatestDownloadFileUrlFromPerformance();
    if (url) return url;
  }
  return getLatestDownloadFileUrlFromPerformance();
}

export async function fetchDownloadAfterClick(
  capture: DownloadFileCapture,
  signal?: AbortSignal,
): Promise<string> {
  const fromCapture = capture.getLatestBody();
  if (fromCapture && fromCapture.length >= MIN_ARTIFACT_BODY_LEN) return fromCapture;

  const latestUrl = capture.getLatestUrl();
  if (latestUrl) {
    const fetched = await fetchClaudeDownloadFile(latestUrl);
    if (fetched.length >= MIN_ARTIFACT_BODY_LEN) return fetched;
  }

  const perfUrl = await waitForDownloadFileUrl(signal);
  if (perfUrl) {
    const fetched = await fetchClaudeDownloadFile(perfUrl);
    if (fetched.length >= MIN_ARTIFACT_BODY_LEN) return fetched;
  }

  return '';
}

export function createDownloadFileCapture(): DownloadFileCapture {
  const bodies = new Map<string, string>();
  let latestUrl: string | undefined;
  let originalFetch: typeof fetch = window.fetch.bind(window);

  const onPageDownload = (event: Event): void => {
    const detail = (event as CustomEvent<{ url: string; body: string }>).detail;
    if (!detail?.url || !detail.body) return;
    bodies.set(detail.url, detail.body);
    latestUrl = detail.url;
  };

  return {
    install() {
      installPageWorldFetchCapture(DOWNLOAD_FILE_EVENT);
      document.addEventListener(DOWNLOAD_FILE_EVENT, onPageDownload);

      originalFetch = window.fetch.bind(window);
      window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const response = await originalFetch(input, init);
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        if (url.includes('download-file')) {
          try {
            const clone = response.clone();
            const text = await clone.text();
            if (text.trim()) {
              bodies.set(url, text.trim());
              latestUrl = url;
            }
          } catch {
            /* ignore clone/read errors */
          }
        }
        return response;
      };
    },
    uninstall() {
      document.removeEventListener(DOWNLOAD_FILE_EVENT, onPageDownload);
      window.fetch = originalFetch;
    },
    getBody(url: string) {
      return bodies.get(url);
    },
    getLatestUrl() {
      return latestUrl;
    },
    getLatestBody() {
      return latestUrl ? bodies.get(latestUrl) : undefined;
    },
  };
}

export function findViewArtifactButton(card: HTMLElement): HTMLElement {
  const viewBtn = card.querySelector('button[aria-label^="View "]');
  if (viewBtn instanceof HTMLElement) return viewBtn;
  const overlay = card.querySelector('button.absolute.inset-0');
  if (overlay instanceof HTMLElement) return overlay;
  return card;
}

export function findAllPasteThumbnailButtons(document: Document): HTMLButtonElement[] {
  const buttons: HTMLButtonElement[] = [];
  document.querySelectorAll('[data-testid="file-thumbnail"] button').forEach((btn) => {
    if (btn instanceof HTMLButtonElement) buttons.push(btn);
  });
  return sortElementsByDomOrder(buttons);
}

export function findAllArtifactBlockCards(document: Document): HTMLElement[] {
  const candidates: HTMLElement[] = [];
  document.querySelectorAll('[class*="artifact-block"]').forEach((el) => {
    if (!(el instanceof HTMLElement)) return;
    if (el.closest('[data-testid="user-message"]')) return;
    candidates.push(el);
  });

  const outermost = candidates.filter(
    (card) => !candidates.some((other) => other !== card && other.contains(card)),
  );
  return sortElementsByDomOrder(outermost);
}

async function waitForContent(
  read: () => string,
  signal?: AbortSignal,
  pollMs: number[] = HYDRATE_POLL_MS,
): Promise<string> {
  for (const ms of pollMs) {
    await sleep(ms, signal);
    const content = read();
    if (content) return content;
  }
  return read();
}

async function hydratePasteThumbnail(
  button: HTMLButtonElement,
  document: Document,
  signal?: AbortSignal,
): Promise<string> {
  button.scrollIntoView?.({ block: 'center', inline: 'nearest' });
  await sleep(100, signal);
  button.click();

  const readAll = (): string => {
    const panel = findPasteContentPanel(document);
    if (!panel) return '';
    const dom = readPastePanelDom(panel);
    return dom.length >= MIN_PASTE_BODY_LEN ? dom : '';
  };

  let content = await waitForContent(readAll, signal, PASTE_HYDRATE_POLL_MS);

  const panel = findPasteContentPanel(document);
  const copyContent = await readPastePanelViaCopy(panel, signal);
  if (copyContent.length > content.length) content = copyContent;

  await dismissPasteContentPanel(document, signal);
  return content;
}

async function readArtifactPanelContent(
  document: Document,
  title: string,
  panel: Element | null,
  signal?: AbortSignal,
): Promise<string> {
  if (!panel) return '';
  const titleNode = findArtifactTitleNode(document, title);
  const dom = readArtifactPanelDom(panel, titleNode);
  if (dom.length >= MIN_ARTIFACT_BODY_LEN) return dom;
  const copyContent = await readPanelViaCopy(panel, signal, titleNode);
  return copyContent.length > dom.length ? copyContent : dom;
}

export function extractArtifactTitle(card: Element): string {
  return (
    card.querySelector('[class*="title"], .line-clamp-1, h1, h2, h3')?.textContent?.trim() ||
    card.getAttribute('aria-label')?.replace(/^View\s+/i, '') ||
    card.textContent?.split('\n')[0]?.trim() ||
    'Generated document'
  )
    .replace(/Document\s*·.*$/i, '')
    .replace(/Spreadsheet\s*·.*$/i, '')
    .trim()
    .slice(0, 120);
}

async function hydrateArtifactCard(
  card: HTMLElement,
  document: Document,
  capture: DownloadFileCapture,
  signal?: AbortSignal,
): Promise<string> {
  card.scrollIntoView?.({ block: 'center', inline: 'nearest' });
  await sleep(100, signal);

  await dismissPasteContentPanel(document, signal);

  const title = extractArtifactTitle(card);
  let content = '';

  try {
    const prePanel = findArtifactPanelForTitle(document, title) ?? findArtifactPanel(document);
    if (prePanel) {
      content = await readArtifactPanelContent(document, title, prePanel, signal);
    }

    if (content.length < MIN_ARTIFACT_BODY_LEN) {
      findViewArtifactButton(card).click();

      const readAll = (): string => {
        const panel = findArtifactPanelForTitle(document, title) ?? findArtifactPanel(document);
        if (panel) {
          const titleNode = findArtifactTitleNode(document, title);
          const dom = readArtifactPanelDom(panel, titleNode);
          if (dom.length >= MIN_ARTIFACT_BODY_LEN) return dom;
        }
        const fromCapture = capture.getLatestBody();
        if (fromCapture && fromCapture.length >= MIN_ARTIFACT_BODY_LEN) return fromCapture;
        return '';
      };

      content = await waitForContent(readAll, signal, PASTE_HYDRATE_POLL_MS);

      const panel = findArtifactPanelForTitle(document, title) ?? findArtifactPanel(document);
      const panelContent = await readArtifactPanelContent(document, title, panel, signal);
      if (panelContent.length > content.length) content = panelContent;

      if (content.length < MIN_ARTIFACT_BODY_LEN) {
        const downloadBtn = card.querySelector(
          'button[aria-label*="Download"], button[aria-label*="download"]',
        );
        if (downloadBtn instanceof HTMLElement) {
          const downloaded = await fetchArtifactContentFallback(title, downloadBtn, capture, signal);
          if (downloaded.length > content.length) content = downloaded;
        }
      }
    }
  } finally {
    await dismissArtifactPanel(document, signal);
  }

  return content;
}

export async function preExtractHydration(
  document: Document,
  onProgress?: ProgressCallback,
  signal?: AbortSignal,
): Promise<HydratedContentCache> {
  const cache = new HydratedContentCache();
  const capture = createDownloadFileCapture();

  try {
    resetClaudeWiggleCache();
    installPageWorldDownloadBlocker();

    const pasteButtons = findAllPasteThumbnailButtons(document);
    for (let i = 0; i < pasteButtons.length; i++) {
      if (signal?.aborted) break;
      onProgress?.({
        phase: 'waiting',
        message: `Loading pasted content ${i + 1} of ${pasteButtons.length}…`,
        percent: 35 + Math.round((i / Math.max(pasteButtons.length, 1)) * 10),
      });

      const ariaLabel = pasteButtons[i].getAttribute('aria-label') ?? 'Pasted content';
      const content = await hydratePasteThumbnail(pasteButtons[i], document, signal);
      if (content) cache.set(cacheKeyForPaste(ariaLabel), content);
    }

    capture.install();

    const artifactCards = findAllArtifactBlockCards(document);
    for (let i = 0; i < artifactCards.length; i++) {
      if (signal?.aborted) break;
      onProgress?.({
        phase: 'waiting',
        message: `Opening document ${i + 1} of ${artifactCards.length}…`,
        percent: 45 + Math.round((i / Math.max(artifactCards.length, 1)) * 10),
      });

      const title = extractArtifactTitle(artifactCards[i]);
      const content = await hydrateArtifactCard(artifactCards[i], document, capture, signal);
      if (content) cache.set(cacheKeyForArtifact(title), content);
    }

    await dismissPasteContentPanel(document, signal);
    await dismissArtifactPanel(document, signal);
  } finally {
    capture.uninstall();
  }

  return cache;
}
