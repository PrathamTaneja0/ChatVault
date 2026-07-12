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

export async function htmlToPdfMakeContent(html: string): Promise<PdfMakeContent[]> {
  const htmlToPdfmakeModule = await import('html-to-pdfmake');
  const htmlToPdfmake = (htmlToPdfmakeModule as { default?: (html: string, options?: Record<string, unknown>) => unknown }).default
    ?? htmlToPdfmakeModule;

  const mainHtml = extractMainHtml(html);
  const result = (htmlToPdfmake as (html: string, options?: Record<string, unknown>) => unknown)(mainHtml, {
    window,
    removeExtraBlanks: true,
    tableAutoSize: true,
    defaultStyles: {
      h1: { fontSize: 20, bold: true, margin: [0, 0, 0, 12] },
      h2: { fontSize: 16, bold: true, margin: [0, 12, 0, 6] },
      h3: { fontSize: 14, bold: true, margin: [0, 10, 0, 4] },
      p: { margin: [0, 0, 0, 8], lineHeight: 1.4 },
      ul: { margin: [0, 0, 0, 8] },
      ol: { margin: [0, 0, 0, 8] },
      li: { margin: [0, 0, 0, 4] },
      pre: { margin: [0, 0, 0, 8], fillColor: '#f4f4f8' },
      code: { fontSize: 9 },
      a: { color: '#2563eb', decoration: 'underline' },
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
      color: '#6b7280',
      margin: [0, 10, 0, 0] as [number, number, number, number],
    }),
    content: bodyContent,
    defaultStyle: {
      font: 'Roboto',
      fontSize: 10,
      lineHeight: 1.4,
      color: '#1f2937',
    },
    styles: {
      'message-role-user': { color: '#4F46E5', bold: true },
      'message-role-assistant': { color: '#059669', bold: true },
      'message-role-reasoning': { color: '#6b7280', bold: true, italics: true },
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
