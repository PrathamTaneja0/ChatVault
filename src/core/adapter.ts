import type { Conversation, ExportOptions, Message } from './schema';

export interface ExtractionProgress {
  phase: 'detecting' | 'scrolling' | 'extracting' | 'waiting' | 'done' | 'error';
  message: string;
  percent: number;
}

export type ProgressCallback = (progress: ExtractionProgress) => void;

export interface PlatformAdapter {
  readonly id: string;
  readonly label: string;
  /** URL patterns this adapter handles */
  readonly urlPatterns: RegExp[];

  /** Check if adapter matches current page */
  matches(url: string): boolean;

  /** Extract conversation from DOM */
  extract(
    document: Document,
    onProgress?: ProgressCallback,
    signal?: AbortSignal,
  ): Promise<Conversation>;

  /** Optional: get selector diagnostics for popup */
  getSelectorDiagnostics?(document: Document): SelectorDiagnostic[];
}

export interface SelectorDiagnostic {
  name: string;
  selector: string;
  found: boolean;
  count: number;
}

export interface AdapterContext {
  options: ExportOptions;
  signal?: AbortSignal;
}

export function filterMessages(
  messages: Message[],
  options: ExportOptions,
): Message[] {
  let filtered = messages;

  if (!options.includeThinking) {
    filtered = filtered.filter((m) => !m.isThinking && m.role !== 'reasoning');
  }

  if (options.selectedMessageIds !== undefined) {
    const ids = new Set(options.selectedMessageIds);
    filtered = filtered.filter((m) => ids.has(m.id));
  }

  return filtered;
}

/** Messages eligible for selection in the overlay (thinking filter only). */
export function getSelectableMessages(
  messages: Message[],
  options: ExportOptions,
): Message[] {
  if (!options.includeThinking) {
    return messages.filter((m) => !m.isThinking && m.role !== 'reasoning');
  }
  return messages;
}

export function dedupeMessages(messages: Message[]): Message[] {
  const seen = new Set<string>();
  const result: Message[] = [];

  for (const msg of messages) {
    const key = `${msg.role}:${msg.content.trim()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(msg);
  }

  return result;
}
