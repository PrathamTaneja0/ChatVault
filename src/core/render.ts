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
import type { Conversation, ExportOptions, Message } from './schema';
import { filterMessages } from './adapter';
import { normalizeContent, formatDate, roleCssClass, roleLabel } from './normalize';
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

function renderMessageHtml(msg: Message, index: number): string {
  const content = normalizeContent(msg);
  const rendered = marked.parse(content) as string;
  const anchor = `msg-${index + 1}`;
  const role = msg.isThinking ? 'reasoning' : msg.role;

  return `
    <section class="message ${roleCssClass(role)}" id="${anchor}">
      <header class="message-header">
        <span class="message-role message-role-${role}">${escapeHtml(roleLabel(role))}</span>
        ${msg.model ? `<span class="message-model">${escapeHtml(msg.model)}</span>` : ''}
        ${msg.timestamp ? `<span class="message-time">${escapeHtml(formatDate(msg.timestamp))}</span>` : ''}
      </header>
      <div class="message-body">${rendered}</div>
    </section>
  `;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderConversationTitle(title: string): string {
  return `
    <header class="conversation-title">
      <h1>${escapeHtml(title)}</h1>
    </header>
  `;
}

function renderToc(messages: Message[]): string {
  if (messages.length <= 10) return '';

  const items = messages
    .map((msg, i) => {
      const preview = normalizeContent(msg).slice(0, 80).replace(/\n/g, ' ');
      const role = msg.isThinking ? 'reasoning' : msg.role;
      return `<li><a href="#msg-${i + 1}"><span class="toc-role">${roleLabel(role)}</span> ${escapeHtml(preview)}…</a></li>`;
    })
    .join('\n');

  return `
    <nav class="toc">
      <h2>Table of Contents</h2>
      <ol>${items}</ol>
    </nav>
    <div class="page-break"></div>
  `;
}

export function renderConversationHtml(
  conversation: Conversation,
  options: ExportOptions,
  mode: RenderMode = 'export',
): string {
  const messages = filterMessages(conversation.messages, options);
  const showToc = options.tableOfContents && messages.length > 10;
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
  ${showToc ? renderToc(messages) : ''}
  <main class="conversation">
    ${renderConversationTitle(title)}
    ${body}
  </main>
</body>
</html>`;
}

export { marked, hljs };
