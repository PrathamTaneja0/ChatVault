import type { Attachment, MessageRole } from './schema';
import { cloneContentWithoutExcluded, generateId, isArtifactLabelOnly } from './extract-utils';

const PASTE_SELECTORS = [
  '[class*="PASTED"]',
  '[data-testid*="paste"]',
  '[class*="paste-preview"]',
];

/** Extract DOM-visible paste/file/artifact text for non-Claude platforms. */
export function extractAttachmentsFromElement(
  el: Element,
  role: MessageRole,
  platform: string,
  messageIndex: number,
): Attachment[] {
  if (platform === 'claude') return [];

  const attachments: Attachment[] = [];
  const seen = new Set<string>();

  const addAttachment = (kind: Attachment['kind'], name: string, content: string) => {
    const trimmed = content.trim();
    if (!trimmed || isArtifactLabelOnly(trimmed, name) || seen.has(trimmed)) return;
    seen.add(trimmed);
    attachments.push({
      id: generateId(`${platform}-attach`, attachments.length + messageIndex * 10),
      kind,
      name,
      content: trimmed,
    });
  };

  for (const sel of PASTE_SELECTORS) {
    el.querySelectorAll(sel).forEach((node) => {
      const clone = cloneContentWithoutExcluded(node, ['button', '[role="button"]']);
      const label =
        node.querySelector('[class*="PASTED"]')?.textContent?.trim() ||
        node.getAttribute('aria-label') ||
        'Pasted content';
      addAttachment('paste', label.slice(0, 80), clone.textContent ?? '');
    });
  }

  if (role === 'user') {
    const prev = el.previousElementSibling;
    if (prev && isPasteElement(prev)) {
      const clone = cloneContentWithoutExcluded(prev, ['button', '[role="button"]']);
      addAttachment('paste', 'Pasted content', clone.textContent ?? '');
    }
  }

  return attachments;
}

function isPasteElement(el: Element): boolean {
  const text = el.textContent ?? '';
  const className = el.className?.toString() ?? '';
  return (
    className.includes('PASTED') ||
    className.includes('paste') ||
    text.includes('PASTED') ||
    !!el.querySelector('[class*="PASTED"]')
  );
}
