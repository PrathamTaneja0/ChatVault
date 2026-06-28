import type { Attachment } from '../core/schema';
import {
  cloneContentWithoutExcluded,
  generateId,
  isArtifactLabelOnly,
  sleep,
} from '../core/extract-utils';

const UI_EXCLUDE = ['button', '[role="button"]', 'nav', '[data-testid="action-bar"]'];

const ARTIFACT_PANEL_SELECTORS = [
  '[class*="artifact"] .standard-markdown',
  '[class*="artifact"] .progressive-markdown',
  '[class*="Artifact"] .standard-markdown',
  '[data-testid*="artifact"] .standard-markdown',
  'aside .standard-markdown',
  '[class*="split-view"] .standard-markdown',
  '[class*="artifact-view"] pre',
];

/** Preceding paste cards / artifact previews bundled with a user turn. */
export function isClaudeUserTurnPrefix(el: Element): boolean {
  if (el.matches('[data-testid="user-message"], .font-claude-response')) return false;
  const className = el.className?.toString() ?? '';
  const text = el.textContent?.trim() ?? '';
  if (className.includes('artifact') || className.includes('PASTED') || className.includes('paste')) {
    return true;
  }
  if (el.querySelector('.artifact-block-cell, [class*="PASTED"]')) return true;
  if (text.includes('PASTED') && text.length > 20) return true;
  return false;
}

export function collectClaudeUserTurnNodes(userEl: Element): Element[] {
  const nodes: Element[] = [];
  let prev = userEl.previousElementSibling;
  while (prev && isClaudeUserTurnPrefix(prev)) {
    nodes.unshift(prev);
    prev = prev.previousElementSibling;
  }
  nodes.push(userEl);
  return nodes;
}

export function buildClaudeUserTurnContent(userEl: Element): { html: string; text: string } {
  const nodes = collectClaudeUserTurnNodes(userEl);
  const parts = nodes.map((node) => {
    const clone = cloneContentWithoutExcluded(node, UI_EXCLUDE);
    return { html: clone.innerHTML, text: clone.textContent?.trim() ?? '' };
  });
  return {
    html: parts.map((p) => p.html).filter(Boolean).join('\n'),
    text: parts.map((p) => p.text).filter(Boolean).join('\n\n'),
  };
}

function extractArtifactTitle(card: Element): string {
  return (
    card.querySelector('h1, h2, h3, [class*="title"]')?.textContent?.trim() ||
    card.getAttribute('aria-label') ||
    card.textContent?.split('\n')[0]?.trim() ||
    'Generated document'
  ).slice(0, 120);
}

function extractVisibleArtifactBody(card: Element): string {
  const pre = card.querySelector('pre, code, .standard-markdown, .progressive-markdown');
  if (pre?.textContent?.trim()) return pre.textContent.trim();
  return card.textContent?.trim() ?? '';
}

function findArtifactCards(assistantEl: Element): HTMLElement[] {
  const seen = new Set<Element>();
  const cards: HTMLElement[] = [];

  const add = (el: Element) => {
    if (!(el instanceof HTMLElement) || seen.has(el)) return;
    seen.add(el);
    cards.push(el);
  };

  assistantEl.querySelectorAll('.artifact-block-cell, [data-testid*="artifact"]').forEach(add);

  assistantEl.querySelectorAll('div, a, button').forEach((el) => {
    if (!(el instanceof HTMLElement)) return;
    const text = el.textContent?.trim() ?? '';
    if (/Document\s*·|Spreadsheet\s*·|\.md\b/i.test(text) && text.length < 250) {
      add(el);
    }
  });

  return cards;
}

function readOpenArtifactPanel(document: Document): string {
  for (const sel of ARTIFACT_PANEL_SELECTORS) {
    for (const panel of document.querySelectorAll(sel)) {
      const text = panel.textContent?.trim() ?? '';
      if (text.length > 100 && !isArtifactLabelOnly(text)) return text;
    }
  }
  return '';
}

async function openArtifactPanelAndRead(
  card: HTMLElement,
  document: Document,
  signal?: AbortSignal,
): Promise<string> {
  const existing = readOpenArtifactPanel(document);
  if (existing.length > 100) return existing;

  card.click();
  await sleep(400, signal);

  let content = readOpenArtifactPanel(document);
  if (content.length > 100) return content;

  const copyBtn = document.querySelector(
    'button[data-testid="action-bar-copy"], button[aria-label*="Copy"]',
  );
  if (copyBtn instanceof HTMLElement) {
    copyBtn.click();
    await sleep(200, signal);
    try {
      const clip = await navigator.clipboard.readText();
      if (clip.trim().length > 50) return clip.trim();
    } catch {
      /* clipboardRead may be unavailable */
    }
  }

  return content;
}

export async function extractClaudeAssistantArtifacts(
  assistantEl: Element,
  document: Document,
  messageIndex: number,
  signal?: AbortSignal,
): Promise<Attachment[]> {
  const attachments: Attachment[] = [];
  const seen = new Set<string>();

  for (const card of findArtifactCards(assistantEl)) {
    const title = extractArtifactTitle(card);
    let content = extractVisibleArtifactBody(card);

    if (isArtifactLabelOnly(content, title)) {
      content = await openArtifactPanelAndRead(card, document, signal);
    }

    const normalized = content.replace(/\s+/g, ' ').trim();
    if (!normalized || isArtifactLabelOnly(normalized, title) || seen.has(normalized)) continue;
    seen.add(normalized);

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

export function extractClaudeUserPastes(userEl: Element, messageIndex: number): Attachment[] {
  const attachments: Attachment[] = [];
  const seen = new Set<string>();

  for (const node of collectClaudeUserTurnNodes(userEl)) {
    if (node === userEl) continue;
    const clone = cloneContentWithoutExcluded(node, UI_EXCLUDE);
    const content = clone.textContent?.trim() ?? '';
    if (!content || isArtifactLabelOnly(content) || seen.has(content)) continue;
    seen.add(content);
    attachments.push({
      id: generateId('claude-paste', messageIndex * 10 + attachments.length),
      kind: 'paste',
      name: content.includes('PASTED') ? 'Pasted content' : 'Attached content',
      content,
    });
  }

  userEl.querySelectorAll('.artifact-block-cell').forEach((cell) => {
    const clone = cloneContentWithoutExcluded(cell, UI_EXCLUDE);
    const content = clone.textContent?.trim() ?? '';
    if (!content || seen.has(content)) return;
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
