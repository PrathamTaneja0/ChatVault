export type MessageType = 'TRIGGER_EXPORT';

export interface ExtensionMessage {
  type: MessageType;
  payload?: unknown;
}

export const STORAGE_KEY_OPTIONS = 'chatvault_export_options';
