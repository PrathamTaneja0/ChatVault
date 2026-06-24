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

function renderMessageHtml(msg: Message, index: number): string {
  const content = normalizeContent(msg);
  const rendered = marked.parse(content) as string;
  const anchor = `msg-${index + 1}`;
  const role = msg.isThinking ? 'reasoning' : msg.role;

  return `
    <section class="message ${roleCssClass(role)}" id="${anchor}">
      <header class="message-header">
        <span class="message-role">${escapeHtml(roleLabel(role))}</span>
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

function renderCoverPage(conv: Conversation): string {
  const { metadata } = conv;
  const title = metadata.title ?? 'Chat Export';
  return `
    <div class="cover-page">
      <h1 class="cover-title">${escapeHtml(title)}</h1>
      <dl class="cover-meta">
        <dt>Platform</dt><dd>${escapeHtml(metadata.platformLabel)}</dd>
        ${metadata.model ? `<dt>Model</dt><dd>${escapeHtml(metadata.model)}</dd>` : ''}
        <dt>Exported</dt><dd>${escapeHtml(formatDate(metadata.exportedAt))}</dd>
        <dt>Messages</dt><dd>${metadata.messageCount}</dd>
        <dt>URL</dt><dd class="cover-url">${escapeHtml(metadata.url)}</dd>
      </dl>
    </div>
    <div class="page-break"></div>
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
): string {
  const messages = filterMessages(conversation.messages, options);
  const showToc = options.tableOfContents && messages.length > 10;
  const showCover = options.coverPage;

  const body = messages.map((m, i) => renderMessageHtml(m, i)).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(conversation.metadata.title ?? 'Chat Export')}</title>
  <style>${printCss}</style>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/styles/github.min.css">
</head>
<body>
  ${showCover ? renderCoverPage({ ...conversation, metadata: { ...conversation.metadata, messageCount: messages.length } }) : ''}
  ${showToc ? renderToc(messages) : ''}
  <main class="conversation">
    ${body}
  </main>
</body>
</html>`;
}

export { marked, hljs };
