export type MessageType = 'TRIGGER_EXPORT' | 'FETCH_IMAGE';

export interface ExtensionMessage {
  type: MessageType;
  payload?: unknown;
}

export interface FetchImageRequest extends ExtensionMessage {
  type: 'FETCH_IMAGE';
  payload: { url: string };
}

export interface FetchImageResponse {
  ok: boolean;
  dataUrl?: string;
  error?: string;
}

export const STORAGE_KEY_OPTIONS = 'chatvault_export_options';
