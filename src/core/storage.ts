import type { ExportOptions } from '../core/schema';
import { DEFAULT_EXPORT_OPTIONS } from '../core/schema';
import { STORAGE_KEY_OPTIONS } from '../core/messages';

export async function loadOptions(): Promise<ExportOptions> {
  try {
    const result = await browser.storage.local.get(STORAGE_KEY_OPTIONS);
    const stored = result[STORAGE_KEY_OPTIONS] as Partial<ExportOptions> | undefined;
    return { ...DEFAULT_EXPORT_OPTIONS, ...stored };
  } catch {
    return { ...DEFAULT_EXPORT_OPTIONS };
  }
}

export async function saveOptions(options: ExportOptions): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEY_OPTIONS]: options });
}
