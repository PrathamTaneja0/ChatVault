import type { ExportOptions } from '../core/schema';
import { DEFAULT_EXPORT_OPTIONS } from '../core/schema';
import { STORAGE_KEY_OPTIONS } from '../core/messages';

export async function loadOptions(): Promise<ExportOptions> {
  try {
    const result = await browser.storage.local.get(STORAGE_KEY_OPTIONS);
    const stored = result[STORAGE_KEY_OPTIONS] as
      | (Partial<ExportOptions> & { coverPage?: boolean; theme?: string })
      | undefined;
    // coverPage and theme are legacy options — strip them on load
    const { coverPage: _legacyCover, theme: _legacyTheme, ...rest } = stored ?? {};
    return { ...DEFAULT_EXPORT_OPTIONS, ...rest };
  } catch {
    return { ...DEFAULT_EXPORT_OPTIONS };
  }
}

export async function saveOptions(options: ExportOptions): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEY_OPTIONS]: options });
}
