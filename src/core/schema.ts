export type MessageRole = 'user' | 'assistant' | 'system' | 'reasoning';

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  /** Raw HTML when available for richer markdown conversion */
  html?: string;
  timestamp?: string;
  model?: string;
  /** Whether this is a thinking/reasoning chain block */
  isThinking?: boolean;
}

export interface ConversationMetadata {
  title?: string;
  platform: string;
  platformLabel: string;
  model?: string;
  url: string;
  exportedAt: string;
  messageCount: number;
}

export interface Conversation {
  metadata: ConversationMetadata;
  messages: Message[];
}

export interface ExportOptions {
  includeThinking: boolean;
  selectedMessageIds?: string[];
  filenameTemplate?: string;
  tableOfContents: boolean;
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  includeThinking: true,
  filenameTemplate: 'ChatVault_{title}',
  tableOfContents: true,
};

export const MAX_TURNS = 500;
export const EXTRACTION_TIMEOUT_MS = 90_000;
