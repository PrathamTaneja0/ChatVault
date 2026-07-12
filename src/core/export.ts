import type { Conversation, ExportOptions } from './schema';
import { filterMessages } from './adapter';
import { renderConversationHtml } from './render';
import {
  applyFilenameTemplate,
  formatFilenameDate,
  sanitizeFilenamePart,
  slugify,
} from './normalize';

export interface ExportResult {
  html: string;
  filename: string;
}

export function buildExportJson(conversation: Conversation, options: ExportOptions): string {
  const messages = filterMessages(conversation.messages, options);
  const payload = {
    metadata: {
      ...conversation.metadata,
      messageCount: messages.length,
    },
    messages,
  };
  return JSON.stringify(payload, null, 2);
}

export function buildExportDocument(
  conversation: Conversation,
  options: ExportOptions,
  mode: 'export' | 'preview' = 'export',
): ExportResult {
  const html = renderConversationHtml(conversation, options, mode);
  const filename = generateFilename(conversation, options);
  return { html, filename };
}

export function generateFilename(
  conversation: Conversation,
  options: ExportOptions,
): string {
  const template = options.filenameTemplate ?? 'ChatVault_{title}';
  const title = conversation.metadata.title ?? 'chat';
  const vars = {
    platform: conversation.metadata.platform,
    title: sanitizeFilenamePart(title, 80),
    date: formatFilenameDate(conversation.metadata.exportedAt),
    model: slugify(conversation.metadata.model ?? 'unknown', 20),
    count: String(filterMessages(conversation.messages, options).length),
  };
  const base = applyFilenameTemplate(template, vars);
  return `${base}.pdf`;
}

export function extractMainHtml(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const main = doc.querySelector('main.conversation');
  return main?.innerHTML ?? doc.body.innerHTML;
}

type PdfMakeContent = Record<string, unknown>;

const PDF_PALETTE = {
  text: '#1f2937',
  heading: '#111827',
  muted: '#6b7280',
  faint: '#9ca3af',
  link: '#4f46e5',
  user: '#4f46e5',
  assistant: '#059669',
  reasoning: '#6b7280',
  surface: '#f9fafb',
  codeBg: '#16161e',
  codeText: '#e2e8f0',
};

/** One Dark token colors — the hljs class names become pdfmake style names. */
const HLJS_PDF_STYLES: Record<string, Record<string, unknown>> = {
  'hljs-comment': { color: '#7f848e', italics: true },
  'hljs-quote': { color: '#7f848e', italics: true },
  'hljs-keyword': { color: '#c678dd' },
  'hljs-doctag': { color: '#c678dd' },
  'hljs-formula': { color: '#c678dd' },
  'hljs-selector-tag': { color: '#c678dd' },
  'hljs-string': { color: '#98c379' },
  'hljs-regexp': { color: '#98c379' },
  'hljs-addition': { color: '#98c379' },
  'hljs-number': { color: '#d19a66' },
  'hljs-literal': { color: '#d19a66' },
  'hljs-title': { color: '#61afef' },
  'hljs-section': { color: '#61afef' },
  function_: { color: '#61afef' },
  class_: { color: '#e5c07b' },
  'hljs-type': { color: '#e5c07b' },
  'hljs-built_in': { color: '#e5c07b' },
  'hljs-class': { color: '#e5c07b' },
  'hljs-attr': { color: '#e06c75' },
  'hljs-attribute': { color: '#e06c75' },
  'hljs-variable': { color: '#e06c75' },
  'hljs-template-variable': { color: '#e06c75' },
  'hljs-name': { color: '#e06c75' },
  'hljs-selector-class': { color: '#e06c75' },
  'hljs-selector-id': { color: '#e06c75' },
  'hljs-deletion': { color: '#e06c75' },
  'hljs-symbol': { color: '#56b6c2' },
  'hljs-bullet': { color: '#56b6c2' },
  'hljs-link': { color: '#56b6c2' },
  'hljs-meta': { color: '#56b6c2' },
  'hljs-selector-attr': { color: '#56b6c2' },
  'hljs-selector-pseudo': { color: '#56b6c2' },
  'hljs-subst': { color: '#56b6c2' },
  'hljs-emphasis': { italics: true },
  'hljs-strong': { bold: true },
};

export async function htmlToPdfMakeContent(html: string): Promise<PdfMakeContent[]> {
  const htmlToPdfmakeModule = await import('html-to-pdfmake');
  const htmlToPdfmake = (htmlToPdfmakeModule as { default?: (html: string, options?: Record<string, unknown>) => unknown }).default
    ?? htmlToPdfmakeModule;

  const palette = PDF_PALETTE;
  const mainHtml = extractMainHtml(html);
  const result = (htmlToPdfmake as (html: string, options?: Record<string, unknown>) => unknown)(mainHtml, {
    window,
    removeExtraBlanks: true,
    tableAutoSize: true,
    defaultStyles: {
      h1: { fontSize: 19, bold: true, color: palette.heading, margin: [0, 0, 0, 10] },
      h2: { fontSize: 15, bold: true, color: palette.heading, margin: [0, 12, 0, 6] },
      h3: { fontSize: 13, bold: true, color: palette.heading, margin: [0, 10, 0, 4] },
      p: { margin: [0, 0, 0, 8], lineHeight: 1.45 },
      ul: { margin: [0, 0, 0, 8] },
      ol: { margin: [0, 0, 0, 8] },
      li: { margin: [0, 0, 0, 4] },
      pre: { margin: [0, 4, 0, 10], fillColor: palette.codeBg, color: palette.codeText },
      code: { fontSize: 8.5 },
      blockquote: { color: palette.muted, fillColor: palette.surface, margin: [8, 0, 0, 8] },
      a: { color: palette.link, decoration: 'underline' },
    },
  });

  if (Array.isArray(result)) return result as PdfMakeContent[];
  if (result && typeof result === 'object' && 'content' in result) {
    return (result as { content: PdfMakeContent[] }).content;
  }
  return [result as PdfMakeContent];
}

export async function downloadViaPdfMake(
  conversation: Conversation,
  options: ExportOptions,
  filename: string,
): Promise<void> {
  const pdfMake = await import('pdfmake/build/pdfmake');
  const pdfFonts = await import('pdfmake/build/vfs_fonts');

  const pdfMakeModule = pdfMake.default ?? pdfMake;
  const fontsModule = pdfFonts as { pdfMake?: { vfs: Record<string, string> }; default?: { pdfMake?: { vfs: Record<string, string> } } };
  const vfs = fontsModule.pdfMake?.vfs ?? fontsModule.default?.pdfMake?.vfs ?? {};
  pdfMakeModule.vfs = vfs;

  const palette = PDF_PALETTE;

  const { html } = buildExportDocument(conversation, options);
  const bodyContent = await htmlToPdfMakeContent(html);

  const docDefinition = {
    info: {
      title: conversation.metadata.title ?? 'Chat Export',
      author: 'ChatVault Export',
    },
    pageSize: 'A4' as const,
    pageMargins: [72, 72, 72, 72] as [number, number, number, number],
    footer: (currentPage: number) => ({
      text: String(currentPage),
      alignment: 'center' as const,
      fontSize: 9,
      color: palette.muted,
      margin: [0, 10, 0, 0] as [number, number, number, number],
    }),
    content: bodyContent,
    defaultStyle: {
      font: 'Roboto',
      fontSize: 10,
      lineHeight: 1.4,
      color: palette.text,
    },
    styles: {
      'doc-eyebrow': { color: palette.faint, fontSize: 7.5, bold: true, characterSpacing: 1 },
      'doc-meta': { color: palette.muted, fontSize: 9 },
      'doc-meta-sep': { color: palette.faint },
      'message-role-user': { color: palette.user, bold: true },
      'message-role-assistant': { color: palette.assistant, bold: true },
      'message-role-reasoning': { color: palette.reasoning, bold: true, italics: true },
      'message-model': { color: palette.faint, fontSize: 8.5 },
      'message-time': { color: palette.faint, fontSize: 8.5 },
      'attachment-title': { color: palette.muted, fontSize: 8.5, bold: true },
      ...HLJS_PDF_STYLES,
    },
  };

  return new Promise((resolve, reject) => {
    try {
      pdfMakeModule.createPdf(docDefinition).download(filename, () => resolve());
    } catch (err) {
      reject(err);
    }
  });
}

export async function silentDownload(
  conversation: Conversation,
  options: ExportOptions,
): Promise<string> {
  const filename = generateFilename(conversation, options);
  await downloadViaPdfMake(conversation, options, filename);
  return filename;
}
