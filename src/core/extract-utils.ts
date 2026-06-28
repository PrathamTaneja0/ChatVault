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

export async function scrollSweep(
  container: Element,
  onProgress?: ProgressCallback,
  signal?: AbortSignal,
  options: { stepPx?: number; delayMs?: number; maxIterations?: number } = {},
): Promise<void> {
  const { stepPx = 800, delayMs = 300, maxIterations = 200 } = options;
  let iterations = 0;
  let lastScrollTop = -1;

  onProgress?.({
    phase: 'scrolling',
    message: 'Scrolling to load all messages…',
    percent: 10,
  });

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
      percent: Math.min(10 + iterations * 0.5, 40),
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
