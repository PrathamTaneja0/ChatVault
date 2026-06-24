import type { Conversation, ExportOptions } from './schema';
import type { ExtractionProgress } from './adapter';

export type MessageType =
  | 'GET_STATUS'
  | 'STATUS_RESPONSE'
  | 'START_EXPORT'
  | 'EXPORT_PROGRESS'
  | 'EXPORT_COMPLETE'
  | 'EXPORT_ERROR'
  | 'CANCEL_EXPORT'
  | 'GET_DIAGNOSTICS'
  | 'DIAGNOSTICS_RESPONSE'
  | 'GET_OPTIONS'
  | 'OPTIONS_RESPONSE'
  | 'SAVE_OPTIONS'
  | 'TRIGGER_EXPORT';

export interface ExtensionMessage {
  type: MessageType;
  payload?: unknown;
}

export interface StatusResponse {
  platform: string | null;
  platformLabel: string | null;
  url: string;
  supported: boolean;
}

export interface ExportProgressPayload extends ExtractionProgress {
  exportPhase?: 'extracting' | 'rendering' | 'printing' | 'downloading';
}

export interface ExportCompletePayload {
  filename: string;
  messageCount: number;
}

export interface ExportErrorPayload {
  error: string;
}

export interface DiagnosticsResponse {
  platform: string | null;
  diagnostics: Array<{
    name: string;
    selector: string;
    found: boolean;
    count: number;
  }>;
}

export interface OptionsPayload {
  options: ExportOptions;
}

export const STORAGE_KEY_OPTIONS = 'chatvault_export_options';
