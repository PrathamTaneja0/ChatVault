import type { Conversation, ExportOptions } from './schema';
import { filterMessages } from './adapter';
import { renderConversationHtml, type RenderMode } from './render';
import {
  applyFilenameTemplate,
  formatFilenameDate,
  normalizeContent,
  sanitizeFilenamePart,
  slugify,
} from './normalize';

export interface ExportResult {
  html: string;
  filename: string;
}

export function buildExportDocument(
  conversation: Conversation,
  options: ExportOptions,
  mode: RenderMode = 'export',
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
    count: String(conversation.messages.length),
  };
  const base = applyFilenameTemplate(template, vars);
  return `${base}.pdf`;
}

export async function printViaIframe(html: string): Promise<void> {
  const iframe = document.createElement('iframe');
  iframe.style.cssText =
    'position:fixed;right:0;bottom:0;width:0;height:0;border:none;';
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument ?? iframe.contentWindow?.document;
  if (!doc) throw new Error('Could not access iframe document');

  doc.open();
  doc.write(html);
  doc.close();

  await waitForFonts(doc);

  return new Promise((resolve, reject) => {
    iframe.contentWindow?.addEventListener('afterprint', () => {
      document.body.removeChild(iframe);
      resolve();
    });

    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch (err) {
      document.body.removeChild(iframe);
      reject(err);
    }
  });
}

async function waitForFonts(doc: Document): Promise<void> {
  await new Promise((r) => setTimeout(r, 500));
  try {
    await (doc as Document & { fonts?: FontFaceSet }).fonts?.ready;
  } catch {
    /* fonts API unavailable */
  }
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
  const textContent = stripHtml(html);

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
    content: buildPdfContent(conversation, options, textContent),
    defaultStyle: {
      font: 'Roboto',
      fontSize: 10,
      lineHeight: 1.4,
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

function buildPdfContent(
  conversation: Conversation,
  options: ExportOptions,
  _fallbackText: string,
): Record<string, unknown>[] {
  const content: Record<string, unknown>[] = [];
  const title = conversation.metadata.title ?? 'Chat Export';

  content.push(
    { text: title, fontSize: 16, bold: true, margin: [0, 0, 0, 16] },
  );

  const messages = filterMessages(conversation.messages, options);
  for (const msg of messages) {
    const role = msg.isThinking ? 'Reasoning' : msg.role;
    const color = role === 'user' ? '#4F46E5' : role === 'assistant' || role === 'Assistant' ? '#059669' : '#6b7280';
    const text = normalizeContent(msg).slice(0, 8000);
    content.push(
      { text: role.toUpperCase(), color, bold: true, margin: [0, 10, 0, 4] },
      { text, margin: [0, 0, 0, 10] },
    );
  }

  return content;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export async function silentDownload(
  conversation: Conversation,
  options: ExportOptions,
): Promise<string> {
  const filename = generateFilename(conversation, options);
  await downloadViaPdfMake(conversation, options, filename);
  return filename;
}
