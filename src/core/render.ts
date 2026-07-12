import { marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import markdown from 'highlight.js/lib/languages/markdown';
import type { Attachment, AttachmentKind, Conversation, ExportOptions, Message } from './schema';
import { filterMessages } from './adapter';
import { normalizeContent, formatDate, roleCssClass, roleLabel } from './normalize';
import { isArtifactLabelOnly, isPasteLabelOnly } from './extract-utils';
import { escapeHtml } from './html-utils';
import printCss from '../assets/print.css?raw';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('json', json);
hljs.registerLanguage('css', css);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('markdown', markdown);

marked.use(
  markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(code, { language: lang }).value;
      }
      return hljs.highlightAuto(code).value;
    },
  }),
);

marked.setOptions({ gfm: true, breaks: true });

export type RenderMode = 'export' | 'preview';

const PREVIEW_SCREEN_CSS = `
@media screen {
  html {
    background: transparent;
    overflow: hidden;
  }
  body {
    margin: 0;
    padding: 25.4mm;
    max-width: 210mm;
    min-height: 297mm;
    background: #fff;
    box-sizing: border-box;
    overflow: hidden;
  }
}
`;

function contentIncludesAttachment(mainContent: string, att: Attachment): boolean {
  const normalize = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  const main = normalize(mainContent);
  const attNorm = normalize(att.content);
  if (attNorm.length < 40) return main.includes(attNorm);
  return main.includes(attNorm.slice(0, Math.min(120, attNorm.length)));
}

function shouldRenderAttachment(att: Attachment, mainContent: string): boolean {
  if (att.kind === 'image') {
    return !!(att.dataUrl || att.sourceUrl);
  }
  if (att.kind === 'paste') {
    if (isPasteLabelOnly(att.content)) return false;
    return !contentIncludesAttachment(mainContent, att);
  }
  if (isArtifactLabelOnly(att.content, att.name)) return false;
  if (att.content.length < 80) return false;
  return !contentIncludesAttachment(mainContent, att);
}

/** Widest an image can render inside A4 margins (px at 96dpi ≈ 160mm). */
const MAX_PDF_IMAGE_WIDTH_PX = 600;

function renderImageAttachment(att: Attachment): string {
  const name = att.name?.trim() || 'Image';

  if (!att.dataUrl) {
    return `
    <div class="message-attachment message-attachment-image image-not-embedded">
      <h4 class="attachment-title">Image</h4>
      <div class="attachment-body">${escapeHtml(name)} (could not be embedded)</div>
    </div>
  `;
  }

  let sizeAttrs = '';
  if (att.width && att.height) {
    const displayWidth = Math.min(att.width, MAX_PDF_IMAGE_WIDTH_PX);
    const displayHeight = Math.round((displayWidth / att.width) * att.height);
    sizeAttrs = ` width="${displayWidth}" height="${displayHeight}"`;
  }
  const caption =
    name && name !== 'Image'
      ? `<div class="image-caption">${escapeHtml(name)}</div>`
      : '';

  return `
    <div class="message-attachment message-attachment-image">
      <img src="${att.dataUrl}" alt="${escapeHtml(name)}"${sizeAttrs} />
      ${caption}
    </div>
  `;
}

function renderSingleAttachment(att: Attachment): string {
  if (att.kind === 'image') return renderImageAttachment(att);
  const title = att.name ?? (att.kind === 'paste' ? 'Pasted content' : 'Attachment');
  const body = marked.parse(att.content) as string;
  return `
    <div class="message-attachment message-attachment-${att.kind}">
      <h4 class="attachment-title">${escapeHtml(title)}</h4>
      <div class="attachment-body">${body}</div>
    </div>
  `;
}

function renderAttachmentsHtml(msg: Message, kinds: AttachmentKind[]): string {
  if (!msg.attachments?.length) return '';
  const mainContent = normalizeContent(msg);
  return msg.attachments
    .filter((att) => kinds.includes(att.kind) && shouldRenderAttachment(att, mainContent))
    .map(renderSingleAttachment)
    .join('');
}

function renderMessageHtml(msg: Message, index: number): string {
  const content = normalizeContent(msg);
  const rendered = marked.parse(content) as string;
  const pasteHtml = renderAttachmentsHtml(msg, ['paste', 'image']);
  const artifactHtml = renderAttachmentsHtml(msg, ['artifact', 'file', 'image']);
  const bodyHtml =
    msg.role === 'user' ? `${pasteHtml}${rendered}` : `${rendered}${artifactHtml}`;
  const anchor = `msg-${index + 1}`;
  const role = msg.isThinking ? 'reasoning' : msg.role;

  return `
    <section class="message ${roleCssClass(role)}" id="${anchor}">
      <header class="message-header">
        <span class="message-role message-role-${role}">${escapeHtml(roleLabel(role))}</span>
        ${msg.model ? `<span class="message-model">${escapeHtml(msg.model)}</span>` : ''}
        ${msg.timestamp ? `<span class="message-time">${escapeHtml(formatDate(msg.timestamp))}</span>` : ''}
      </header>
      <div class="message-body">${bodyHtml}</div>
    </section>
  `;
}

function renderConversationTitle(title: string): string {
  return `
    <header class="conversation-title">
      <h1>${escapeHtml(title)}</h1>
    </header>
  `;
}

export function renderConversationHtml(
  conversation: Conversation,
  options: ExportOptions,
  mode: RenderMode = 'export',
): string {
  const messages = filterMessages(conversation.messages, options);
  const title = conversation.metadata.title ?? 'Chat Export';

  const body = messages.map((m, i) => renderMessageHtml(m, i)).join('\n');
  const previewCss = mode === 'preview' ? PREVIEW_SCREEN_CSS : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>${printCss}${previewCss}</style>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/styles/github.min.css">
</head>
<body>
  <main class="conversation">
    ${renderConversationTitle(title)}
    ${body}
  </main>
</body>
</html>`;
}

export { marked, hljs };
