import type { Attachment } from '../core/schema';
import {
  cloneContentWithoutExcluded,
  generateId,
  isArtifactLabelOnly,
  sleep,
  sortElementsByDomOrder,
} from '../core/extract-utils';
import type { HydratedContentCache } from './claude-hydrate';
import {
  cacheKeyForArtifact,
  cacheKeyForPaste,
  createDownloadFileCapture,
  fetchDownloadAfterClick,
  findArtifactPanel,
  findArtifactPanelForTitle,
  findArtifactTitleNode,
  findPanelCopyButton,
  findViewArtifactButton,
  readArtifactPanelDom,
  readPanelViaCopy,
  fetchClaudeDownloadFile,
} from './claude-hydrate';

const UI_EXCLUDE = [
  'button',
  '[role="button"]',
  'nav',
  '[data-testid="action-bar"]',
  '[class*="PASTED"]',
  '[data-testid="file-thumbnail"]',
];

const ASSISTANT_STRIP_SELECTORS = [
  '.thinking-block',
  '[data-is-thinking="true"]',
  '.artifact-block-cell',
  '[class*="artifact-block"]',
  '[data-testid*="artifact"]',
  'button',
  '[role="button"]',
  '[data-testid="action-bar"]',
  '[aria-label="Message actions"]',
];

const PASTE_NODE_SELECTORS = [
  '[data-testid="file-thumbnail"]',
  '.artifact-block-cell',
  '[class*="paste-preview"]',
  '[class*="paste"]',
  '[data-testid*="paste"]',
];

const ARTIFACT_RETRY_MS = [300, 600, 1200, 2000];

function normalizeForCompare(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Reject artifact bodies that duplicate a preceding user turn (clipboard false positives). */
export function contentMatchesUserMessage(content: string, userTexts: string[]): boolean {
  const normalized = normalizeForCompare(content);
  if (!normalized) return false;

  return userTexts.some((userText) => {
    const userNorm = normalizeForCompare(userText);
    if (!userNorm || userNorm.length < 20) return false;
    if (normalized === userNorm) return true;
    const shorter = Math.min(normalized.length, userNorm.length);
    const longer = Math.max(normalized.length, userNorm.length);
    if (shorter / longer < 0.85) return false;
    return normalized.includes(userNorm) || userNorm.includes(normalized);
  });
}

/** Turn wrapper containing paste card + user message. */
export function findClaudeUserTurnRoot(userEl: Element): Element {
  const groupWithPaste = userEl.closest('.group');
  if (
    groupWithPaste?.querySelector('[data-testid="file-thumbnail"]') &&
    groupWithPaste.contains(userEl)
  ) {
    return groupWithPaste;
  }

  const renderGroup = userEl.closest('[data-test-render-count]');
  if (renderGroup) return renderGroup;

  let parent = userEl.parentElement;
  while (parent && parent !== document.body) {
    const hasPasteOutsideUser = [...parent.querySelectorAll(PASTE_NODE_SELECTORS.join(','))].some(
      (node) => !userEl.contains(node),
    );
    if (hasPasteOutsideUser) return parent;
    parent = parent.parentElement;
  }

  return (
    userEl.closest('[class*="group"]') ??
    userEl.closest('[class*="grid"]') ??
    userEl.parentElement ??
    userEl
  );
}

/** Preceding paste cards / artifact previews bundled with a user turn. */
export function isClaudeUserTurnPrefix(el: Element): boolean {
  if (el.matches('[data-testid="user-message"], .font-claude-response')) return false;
  if (el.closest('.font-claude-response, [data-testid="user-message"]')) return false;
  if (el.matches('[data-testid="file-thumbnail"]') || el.closest('[data-testid="file-thumbnail"]')) {
    return true;
  }
  const className = el.className?.toString() ?? '';
  const text = el.textContent?.trim() ?? '';
  if (className.includes('artifact') || className.includes('PASTED') || className.includes('paste')) {
    return true;
  }
  if (el.querySelector('.artifact-block-cell, [class*="PASTED"]')) return true;
  if (text.includes('PASTED') && text.length > 20) return true;
  return false;
}

function isPasteNode(el: Element, userEl: Element): boolean {
  if (el.closest('.font-claude-response')) return false;
  if (userEl.contains(el) && el !== userEl) {
    return (
      !!el.closest('.artifact-block-cell, [data-testid="file-thumbnail"]') ||
      isClaudeUserTurnPrefix(el)
    );
  }
  if (el === userEl || userEl.contains(el)) return false;
  return isClaudeUserTurnPrefix(el);
}

function isBeforeInDocument(before: Element, after: Element): boolean {
  return (after.compareDocumentPosition(before) & Node.DOCUMENT_POSITION_PRECEDING) !== 0;
}

function isSameUserTurnGroup(el: Element, userEl: Element): boolean {
  const userGroup = userEl.closest('[data-test-render-count]');
  const elGroup = el.closest('[data-test-render-count]');
  if (userGroup && elGroup) return userGroup === elGroup;
  const turnRoot = findClaudeUserTurnRoot(userEl);
  return turnRoot.contains(el);
}

/** Collect paste nodes within turn wrapper and preceding siblings. */
export function collectPasteNodesInTurn(turnRoot: Element, userEl: Element): Element[] {
  const seen = new Set<Element>();
  const nodes: Element[] = [];

  const add = (el: Element) => {
    if (seen.has(el) || el === userEl || userEl.contains(el)) return;
    if (!isPasteNode(el, userEl)) return;
    if (el.closest('[data-testid="file-thumbnail"]') && !isSameUserTurnGroup(el, userEl)) return;
    seen.add(el);
    nodes.push(el);
  };

  for (const sel of PASTE_NODE_SELECTORS) {
    turnRoot.querySelectorAll(sel).forEach((el) => {
      if (!userEl.contains(el)) add(el);
    });
  }

  let ancestor: Element | null = userEl.parentElement;
  while (ancestor && ancestor !== document.body) {
    for (const sel of PASTE_NODE_SELECTORS) {
      ancestor.querySelectorAll(sel).forEach((el) => {
        if (!userEl.contains(el) && isBeforeInDocument(el, userEl)) add(el);
      });
    }
    if (ancestor.matches('[data-test-render-count]')) break;
    ancestor = ancestor.parentElement;
  }

  turnRoot.querySelectorAll('*').forEach((el) => {
    if (el.textContent?.includes('PASTED') && (el.textContent?.length ?? 0) > 30) {
      add(el);
    }
  });

  let prev = userEl.previousElementSibling;
  while (prev && isClaudeUserTurnPrefix(prev)) {
    add(prev);
    prev = prev.previousElementSibling;
  }

  let walk: Element | null = userEl.parentElement;
  while (walk && turnRoot.contains(walk)) {
    let sib = walk.previousElementSibling;
    while (sib) {
      if (sib.querySelector('[data-testid="file-thumbnail"]')) add(sib);
      sib = sib.previousElementSibling;
    }
    walk = walk.parentElement;
  }

  return sortElementsByDomOrder(nodes);
}

export function collectClaudeUserTurnNodes(userEl: Element): Element[] {
  const turnRoot = findClaudeUserTurnRoot(userEl);
  const pasteNodes = collectPasteNodesInTurn(turnRoot, userEl);
  const inlinePastes = pasteNodes.filter((n) => !n.closest('[data-testid="file-thumbnail"]'));
  return [...inlinePastes, userEl];
}

function stripPastedLabel(text: string): string {
  return text.replace(/\bPASTED\b/g, '').trim();
}

export function buildClaudeUserTurnContent(userEl: Element): { html: string; text: string } {
  const nodes = collectClaudeUserTurnNodes(userEl);
  const parts = nodes.map((node) => {
    const clone = cloneContentWithoutExcluded(node, UI_EXCLUDE);
    const rawText = clone.textContent?.trim() ?? '';
    return {
      html: clone.innerHTML,
      text: stripPastedLabel(rawText),
    };
  });
  return {
    html: parts.map((p) => p.html).filter(Boolean).join('\n'),
    text: parts.map((p) => p.text).filter(Boolean).join('\n\n'),
  };
}

function stripThinkingRowsFromClone(clone: Element): void {
  clone.querySelectorAll('.row-start-1').forEach((row) => {
    if (
      row.matches('.thinking-block, [data-is-thinking="true"]') ||
      row.querySelector('.thinking-block, [data-is-thinking="true"]')
    ) {
      row.remove();
    }
  });
}

function stripSrOnlyFromClone(clone: Element): void {
  clone.querySelectorAll('.sr-only, [role="status"].sr-only').forEach((node) => node.remove());
  clone.querySelectorAll('[class*="group/status"], button[class*="group/status"]').forEach((node) => {
    node.remove();
  });
  clone.querySelectorAll('[style*="grid-template-rows"]').forEach((row) => {
    const style = row.getAttribute('style') ?? '';
    if (style.includes('0fr') && !(row.textContent?.trim() ?? '').replace(/\s+/g, '')) {
      row.remove();
    }
  });
}

/** Clone full assistant turn; strip thinking rows and artifact card chrome. */
export function extractClaudeAssistantCommentary(assistantEl: Element): { html: string; text: string } {
  const clone = assistantEl.cloneNode(true) as Element;
  stripThinkingRowsFromClone(clone);
  stripSrOnlyFromClone(clone);
  ASSISTANT_STRIP_SELECTORS.forEach((sel) => {
    clone.querySelectorAll(sel).forEach((node) => node.remove());
  });
  const trimmed = cloneContentWithoutExcluded(clone, UI_EXCLUDE);
  return {
    html: trimmed.innerHTML,
    text: stripPastedLabel(trimmed.textContent?.trim() ?? ''),
  };
}

function findClickableArtifactTarget(card: HTMLElement): HTMLElement {
  return findViewArtifactButton(card);
}

function extractArtifactTitle(card: Element): string {
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

function extractVisibleArtifactBody(card: Element): string {
  const pre = card.querySelector('pre, code, .standard-markdown, .progressive-markdown');
  if (pre?.textContent?.trim() && !isArtifactLabelOnly(pre.textContent.trim())) {
    return pre.textContent.trim();
  }
  const text = card.textContent?.trim() ?? '';
  return isArtifactLabelOnly(text) ? '' : text;
}

function findArtifactCards(assistantEl: Element): HTMLElement[] {
  const candidates: HTMLElement[] = [];
  assistantEl.querySelectorAll('[class*="artifact-block"], [data-testid*="artifact-card"]').forEach(
    (el) => {
      if (el instanceof HTMLElement) candidates.push(el);
    },
  );

  return candidates.filter(
    (card) => !candidates.some((other) => other !== card && other.contains(card)),
  );
}

function readOpenArtifactPanel(document: Document, title?: string, baselineLength = 0): string {
  const panel =
    (title ? findArtifactPanelForTitle(document, title) : null) ?? findArtifactPanel(document);
  if (!panel) return '';
  const titleNode = title ? findArtifactTitleNode(document, title) : null;
  const content = readArtifactPanelDom(panel, titleNode);
  if (content.length > baselineLength && content.length > 100) return content;
  return '';
}

async function readOpenArtifactPanelFull(
  document: Document,
  title: string,
  panel: Element | null,
  signal?: AbortSignal,
): Promise<string> {
  if (!panel) return '';
  const titleNode = findArtifactTitleNode(document, title);
  const dom = readArtifactPanelDom(panel, titleNode);
  if (dom.length > 100) return dom;
  const copyContent = await readPanelViaCopy(panel, signal, titleNode);
  return copyContent.length > dom.length ? copyContent : dom;
}

async function openArtifactPanelAndRead(
  card: HTMLElement,
  document: Document,
  signal?: AbortSignal,
): Promise<string> {
  const title = extractArtifactTitle(card);
  const preOpened = readOpenArtifactPanel(document, title);
  if (preOpened.length > 100) return preOpened;

  const capture = createDownloadFileCapture();
  capture.install();

  try {
    const baseline = preOpened.length;
    findClickableArtifactTarget(card).click();

    for (const waitMs of ARTIFACT_RETRY_MS) {
      await sleep(waitMs, signal);

      const panel =
        findArtifactPanelForTitle(document, title) ?? findArtifactPanel(document);
      const panelContent = readOpenArtifactPanel(document, title, baseline);
      if (panelContent.length > 100) return panelContent;

      const fullPanelContent = await readOpenArtifactPanelFull(document, title, panel, signal);
      if (fullPanelContent.length > 100) return fullPanelContent;

      const captured = capture.getLatestBody();
      if (captured && captured.length > 80) return captured;
    }

    const panel = findArtifactPanelForTitle(document, title) ?? findArtifactPanel(document);
    const panelFinal = readOpenArtifactPanel(document, title, baseline);
    if (panelFinal.length > 100) return panelFinal;

    const finalFull = await readOpenArtifactPanelFull(document, title, panel, signal);
    if (finalFull.length > 100) return finalFull;

    const captured = capture.getLatestBody();
    if (captured && captured.length > 80) return captured;

    const latestUrl = capture.getLatestUrl();
    if (latestUrl) {
      const fetched = await fetchClaudeDownloadFile(latestUrl);
      if (fetched.length > 80) return fetched;
    }

    const downloadBtn = card.querySelector(
      'button[aria-label*="Download"], button[aria-label*="download"]',
    );
    if (downloadBtn instanceof HTMLElement) {
      downloadBtn.click();
      await sleep(300, signal);
      const downloaded = await fetchDownloadAfterClick(capture, signal);
      if (downloaded.length > 80) return downloaded;
    }

    return readOpenArtifactPanel(document, title, baseline);
  } finally {
    capture.uninstall();
  }
}

export async function extractClaudeAssistantArtifacts(
  assistantEl: Element,
  document: Document,
  messageIndex: number,
  signal?: AbortSignal,
  priorUserTexts: string[] = [],
  cache?: HydratedContentCache,
): Promise<Attachment[]> {
  const attachments: Attachment[] = [];
  const seen = new Set<string>();

  for (const card of findArtifactCards(assistantEl)) {
    const title = extractArtifactTitle(card);
    let content = cache?.get(cacheKeyForArtifact(title)) ?? cache?.getFuzzy(title) ?? '';

    if (!content) {
      content = extractVisibleArtifactBody(card);
    }

    if (!content || isArtifactLabelOnly(content, title)) {
      content = await openArtifactPanelAndRead(card, document, signal);
    }

    const normalized = content.trim();
    if (!normalized || isArtifactLabelOnly(normalized, title)) continue;
    if (contentMatchesUserMessage(normalized, priorUserTexts)) continue;
    if (cache?.contentMatchesCachedEntry(normalized, [cacheKeyForArtifact(title)])) continue;

    const dedupeKey = normalized.replace(/\s+/g, ' ').slice(0, 200);
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    attachments.push({
      id: generateId('claude-artifact', messageIndex * 10 + attachments.length),
      kind: 'artifact',
      name: title,
      content: normalized,
      mimeType: 'text/markdown',
    });
  }

  return attachments;
}

function isPasteLabelOnly(content: string): boolean {
  const trimmed = content.trim();
  return trimmed === 'PASTED' || (trimmed.length < 25 && !trimmed.includes('\n') && !trimmed.startsWith('#'));
}

/** Read truncated preview from file-thumbnail before UI_EXCLUDE strips the button. */
export function extractPastePreviewFromNode(node: Element): string {
  const thumbnail = node.closest('[data-testid="file-thumbnail"]') ?? node;
  const btn = thumbnail.querySelector('button');
  if (btn) {
    const previewEl =
      btn.querySelector('p.line-clamp-\\[6\\], p:not(.uppercase), pre') ?? btn;
    return stripPastedLabel(previewEl.textContent?.trim() ?? '');
  }
  const clone = cloneContentWithoutExcluded(node, UI_EXCLUDE);
  return stripPastedLabel(clone.textContent?.trim() ?? '');
}

function resolvePasteContent(
  node: Element,
  previewContent: string,
  cache?: HydratedContentCache,
): string {
  const thumbnail = node.closest('[data-testid="file-thumbnail"]') ?? node;
  const btn = thumbnail.querySelector('button');
  const ariaLabel = btn?.getAttribute('aria-label') ?? 'Pasted content';

  const cached = cache?.get(cacheKeyForPaste(ariaLabel)) ?? cache?.getFuzzy(ariaLabel);
  if (cached && (!previewContent || cached.length > previewContent.length * 3)) {
    return cached;
  }
  return previewContent;
}

export function extractClaudeUserPastes(
  userEl: Element,
  messageIndex: number,
  cache?: HydratedContentCache,
): Attachment[] {
  const attachments: Attachment[] = [];
  const seen = new Set<string>();

  const turnRoot = findClaudeUserTurnRoot(userEl);
  const pasteNodes = collectPasteNodesInTurn(turnRoot, userEl);

  for (const node of pasteNodes) {
    const preview = extractPastePreviewFromNode(node);
    const content = resolvePasteContent(node, preview, cache);
    if (!content || isPasteLabelOnly(content) || seen.has(content)) continue;
    seen.add(content);
    attachments.push({
      id: generateId('claude-paste', messageIndex * 10 + attachments.length),
      kind: 'paste',
      name: 'Pasted content',
      content,
    });
  }

  userEl.querySelectorAll('.artifact-block-cell').forEach((cell) => {
    if (cell.closest('[data-testid="file-thumbnail"]')) return;
    const preview = extractPastePreviewFromNode(cell);
    const content = resolvePasteContent(cell, preview, cache);
    if (!content || isPasteLabelOnly(content) || seen.has(content)) return;
    seen.add(content);
    attachments.push({
      id: generateId('claude-paste', messageIndex * 10 + attachments.length),
      kind: 'paste',
      name: 'Pasted content',
      content,
    });
  });

  return attachments;
}

// Re-export for tests
export { findPanelCopyButton, fetchClaudeDownloadFile };
