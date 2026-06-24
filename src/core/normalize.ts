import TurndownService from 'turndown';
import type { Message, MessageRole } from './schema';

let turndownInstance: TurndownService | null = null;

export function getTurndown(): TurndownService {
  if (!turndownInstance) {
    turndownInstance = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-',
    });
    turndownInstance.addRule('preCode', {
      filter: (node) =>
        node.nodeName === 'PRE' ||
        (node.nodeName === 'CODE' && node.parentElement?.nodeName === 'PRE'),
      replacement: (_content, node) => {
        const el = node as HTMLElement;
        const code = el.textContent ?? '';
        const lang =
          el.getAttribute('data-language') ??
          el.className.match(/language-(\w+)/)?.[1] ??
          '';
        return `\n\`\`\`${lang}\n${code}\n\`\`\`\n`;
      },
    });
  }
  return turndownInstance;
}

export function htmlToMarkdown(html: string): string {
  return getTurndown().turndown(html);
}

export function normalizeContent(message: Message): string {
  if (message.html) {
    return htmlToMarkdown(message.html);
  }
  return message.content.trim();
}

export function roleLabel(role: MessageRole): string {
  switch (role) {
    case 'user':
      return 'You';
    case 'assistant':
      return 'Assistant';
    case 'system':
      return 'System';
    case 'reasoning':
      return 'Reasoning';
    default:
      return role;
  }
}

export function roleCssClass(role: MessageRole): string {
  return `message-${role}`;
}

export function slugify(text: string, maxLen = 50): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, maxLen)
    .replace(/-$/, '');
}

export function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function formatFilenameDate(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  } catch {
    return 'export';
  }
}

export function applyFilenameTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }
  return result
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 200);
}
