import type { ProgressCallback } from './adapter';
import { EXTRACTION_TIMEOUT_MS, MAX_TURNS } from './schema';

export class CircuitBreakerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CircuitBreakerError';
  }
}

export function createAbortableTimeout(
  signal?: AbortSignal,
  timeoutMs = EXTRACTION_TIMEOUT_MS,
): { promise: Promise<never>; cleanup: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new CircuitBreakerError(`Extraction timed out after ${timeoutMs / 1000}s`)),
      timeoutMs,
    );
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new CircuitBreakerError('Extraction cancelled'));
    });
  });
  return {
    promise,
    cleanup: () => clearTimeout(timer),
  };
}

export async function withCircuitBreaker<T>(
  fn: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const { promise: timeout, cleanup } = createAbortableTimeout(signal);
  try {
    return await Promise.race([fn(), timeout]);
  } finally {
    cleanup();
  }
}

export function enforceTurnLimit(count: number): void {
  if (count > MAX_TURNS) {
    throw new CircuitBreakerError(
      `Conversation exceeds ${MAX_TURNS} message limit (${count} found)`,
    );
  }
}

/** Cheap scrollability check (no style computation). */
export function isElementScrollable(el: Element): boolean {
  return el.scrollHeight > el.clientHeight + 40;
}

function findLargestScrollableDescendant(root: Element): Element | null {
  let best: Element | null = null;
  let bestHeight = 0;
  for (const el of root.querySelectorAll('*')) {
    if (el.clientHeight < 200) continue;
    if (!isElementScrollable(el)) continue;
    if (el.clientHeight > bestHeight) {
      best = el;
      bestHeight = el.clientHeight;
    }
  }
  return best;
}

/**
 * Resolve the element that actually scrolls the chat. Candidate selectors are
 * checked directly, then their descendants, then their ancestors — the first
 * genuinely scrollable element wins. Falls back to the first candidate match.
 */
export function findScrollableContainer(
  doc: Document,
  candidateSelectors: string[],
): Element {
  const candidates: Element[] = [];
  for (const sel of candidateSelectors) {
    if (!sel) continue;
    doc.querySelectorAll(sel).forEach((el) => candidates.push(el));
  }

  for (const el of candidates) {
    if (isElementScrollable(el)) return el;
  }

  for (const el of candidates) {
    const descendant = findLargestScrollableDescendant(el);
    if (descendant) return descendant;
  }

  for (const el of candidates) {
    let parent = el.parentElement;
    while (parent && parent !== doc.body) {
      if (isElementScrollable(parent)) return parent;
      parent = parent.parentElement;
    }
  }

  return candidates[0] ?? doc.scrollingElement ?? doc.body;
}

/**
 * Force lazy/virtualized messages into the DOM.
 *
 * Chat UIs open scrolled to the bottom and load *older* turns when the user
 * scrolls up, so phase 1 holds the container at the top until its scrollHeight
 * stops growing. Phase 2 then steps back down for lists that also mount
 * content downward.
 */
export async function scrollSweep(
  container: Element,
  onProgress?: ProgressCallback,
  signal?: AbortSignal,
  options: { stepPx?: number; delayMs?: number; maxIterations?: number } = {},
): Promise<void> {
  const { stepPx = 800, delayMs = 300, maxIterations = 200 } = options;

  onProgress?.({
    phase: 'scrolling',
    message: 'Loading conversation history…',
    percent: 10,
  });

  let stable = 0;
  let lastHeight = -1;
  for (let i = 0; i < maxIterations && stable < 3; i++) {
    if (signal?.aborted) throw new CircuitBreakerError('Extraction cancelled');

    container.scrollTop = 0;
    await sleep(delayMs, signal);

    const height = container.scrollHeight;
    if (height === lastHeight) {
      stable++;
    } else {
      stable = 0;
    }
    lastHeight = height;

    onProgress?.({
      phase: 'scrolling',
      message: `Loading earlier messages… (${i + 1})`,
      percent: Math.min(10 + i * 0.5, 25),
    });
  }

  let iterations = 0;
  let lastScrollTop = -1;
  while (iterations < maxIterations) {
    if (signal?.aborted) throw new CircuitBreakerError('Extraction cancelled');

    const scrollTop = container.scrollTop;
    if (scrollTop === lastScrollTop && iterations > 0) break;
    lastScrollTop = scrollTop;

    container.scrollTop += stepPx;
    await sleep(delayMs, signal);
    iterations++;

    onProgress?.({
      phase: 'scrolling',
      message: `Scrolling… (${iterations})`,
      percent: Math.min(25 + iterations * 0.5, 40),
    });
  }

  container.scrollTop = 0;
  await sleep(200, signal);
}

export async function virtualScrollSweep(
  container: Element,
  itemSelector: string,
  onProgress?: ProgressCallback,
  signal?: AbortSignal,
): Promise<void> {
  onProgress?.({
    phase: 'scrolling',
    message: 'Virtual scroll sweep…',
    percent: 10,
  });

  const seen = new Set<string>();
  let stable = 0;

  for (let i = 0; i < 300; i++) {
    if (signal?.aborted) throw new CircuitBreakerError('Extraction cancelled');

    const items = container.querySelectorAll(itemSelector);
    const prevSize = seen.size;

    items.forEach((el, idx) => {
      const key = el.getAttribute('data-message-id') ?? `${idx}:${el.textContent?.slice(0, 80)}`;
      seen.add(key);
      el.scrollIntoView({ block: 'center' });
    });

    container.scrollTop = container.scrollHeight;
    await sleep(250, signal);

    if (seen.size === prevSize) {
      stable++;
      if (stable >= 3) break;
    } else {
      stable = 0;
    }

    onProgress?.({
      phase: 'scrolling',
      message: `Loading messages… (${seen.size})`,
      percent: Math.min(10 + seen.size * 0.3, 40),
    });
  }

  container.scrollTop = 0;
}

export async function waitForStreaming(
  isStreamingFn: () => boolean,
  onProgress?: ProgressCallback,
  signal?: AbortSignal,
  maxWaitMs = 30_000,
): Promise<void> {
  const start = Date.now();
  onProgress?.({
    phase: 'waiting',
    message: 'Waiting for response to finish…',
    percent: 5,
  });

  while (isStreamingFn()) {
    if (signal?.aborted) throw new CircuitBreakerError('Extraction cancelled');
    if (Date.now() - start > maxWaitMs) break;
    await sleep(500, signal);
  }
}

export function queryFirst(root: ParentNode, selectors: string[]): Element | null {
  for (const sel of selectors) {
    const el = root.querySelector(sel);
    if (el) return el;
  }
  return null;
}

export function queryAllFirst(root: ParentNode, selectors: string[]): NodeListOf<Element> {
  for (const sel of selectors) {
    const els = root.querySelectorAll(sel);
    if (els.length > 0) return els;
  }
  return root.querySelectorAll('.__nonexistent__');
}

/** Query every selector, dedupe, and return elements in DOM order. */
export function queryAllMerged(root: ParentNode, selectors: string[]): Element[] {
  const seen = new Set<Element>();
  const merged: Element[] = [];

  for (const sel of selectors) {
    for (const el of root.querySelectorAll(sel)) {
      if (!seen.has(el)) {
        seen.add(el);
        merged.push(el);
      }
    }
  }

  merged.sort((a, b) => {
    const pos = a.compareDocumentPosition(b);
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });

  return merged;
}

export function isArtifactLabelOnly(content: string, title?: string): boolean {
  const trimmed = content.replace(/\s+/g, ' ').trim();
  if (trimmed.length < 80) return true;
  if (/Document\s*·|Spreadsheet\s*·|\.md\s*$/i.test(trimmed) && trimmed.length < 120) return true;
  if (title && trimmed === title.replace(/\s+/g, ' ').trim()) return true;
  return false;
}

export function isPasteLabelOnly(content: string): boolean {
  const trimmed = content.trim();
  return trimmed === 'PASTED' || (trimmed.length < 25 && !trimmed.includes('\n') && !trimmed.startsWith('#'));
}

/** Drop elements nested inside another matched message node. */
export function filterNestedMessageElements(elements: Element[]): Element[] {
  return elements.filter(
    (el) => !elements.some((other) => other !== el && other.contains(el)),
  );
}

export function sortElementsByDomOrder<T extends Element>(elements: T[]): T[] {
  return [...elements].sort((a, b) => {
    const pos = a.compareDocumentPosition(b);
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });
}

export function generateId(prefix: string, index: number): string {
  return `${prefix}-${index}-${Date.now().toString(36)}`;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new CircuitBreakerError('Extraction cancelled'));
    });
  });
}

export function getPageTitle(doc: Document): string {
  return (
    doc.querySelector('title')?.textContent?.trim() ??
    doc.title ??
    'Untitled Chat'
  );
}

/** Default UI chrome stripped from assistant message content. */
export const DEFAULT_ASSISTANT_EXCLUDE_SELECTORS = [
  'button',
  'nav',
  '[role="button"]',
];

/** Clone a content node and remove excluded descendant elements before reading text/HTML. */
export function cloneContentWithoutExcluded(
  contentEl: Element,
  excludeSelectors: string[] = [],
): HTMLElement {
  const clone = contentEl.cloneNode(true) as HTMLElement;
  for (const sel of excludeSelectors) {
    if (!sel) continue;
    clone.querySelectorAll(sel).forEach((node) => node.remove());
  }
  return clone;
}
