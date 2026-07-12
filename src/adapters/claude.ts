import type { Conversation, Message } from '../core/schema';
import type { PlatformAdapter } from '../core/adapter';
import { dedupeMessages } from '../core/adapter';
import {
  enforceTurnLimit,
  filterNestedMessageElements,
  findScrollableContainer,
  generateId,
  getPageTitle,
  queryAllFirst,
  scrollSweep,
  sortElementsByDomOrder,
  withCircuitBreaker,
} from '../core/extract-utils';
import { normalizeContent, resolveConversationTitle, stripSuggestionChipText } from '../core/normalize';
import {
  buildClaudeUserTurnContent,
  extractClaudeAssistantArtifacts,
  extractClaudeAssistantCommentary,
  extractClaudeUserPastes,
} from './claude-extract';
import { preExtractHydration, isClaudeChatStreamTurn } from './claude-hydrate';
import { extractClaudeViaApi } from '../sources/claude-api';
import { createBaseAdapter } from './base';

const selectors = {
  container: ['main', '.flex-1.overflow-y-auto', '[data-testid="conversation"]'],
  message: [
    '[data-testid="user-message"]',
    '.font-claude-response',
    '[data-is-streaming]',
    '[data-testid="assistant-message"]',
    '[data-testid="ai-message"]',
  ],
  roleUser: ['[data-testid="user-message"]', '[class*="font-user-message"]'],
  roleAssistant: [
    '.font-claude-response',
    '[data-is-streaming]',
    '[data-testid="assistant-message"]',
    '[data-testid="ai-message"]',
    '.font-claude-message',
  ],
  content: [
    '.standard-markdown',
    '.progressive-markdown',
    '.font-claude-response-body',
    '[class*="markdown"]',
    '.markdown',
    '.prose',
  ],
  title: ['[data-testid="chat-title"]', 'title'],
  model: ['[data-testid="model-selector"]'],
  thinking: ['.thinking-block', '[data-is-thinking="true"]'],
};

const excludeSelectors = [
  'button[data-testid="action-bar-copy"]',
  '[data-testid="action-bar"]',
  '[aria-label="Message actions"]',
];

function expandClaudePasteBlocks(document: Document): void {
  document
    .querySelectorAll('.artifact-block-cell button, [class*="paste"] button, [class*="PASTED"] button')
    .forEach((btn) => {
      if (btn instanceof HTMLButtonElement) {
        const label =
          btn.getAttribute('aria-label')?.toLowerCase() ?? btn.textContent?.toLowerCase() ?? '';
        if (label.includes('expand') || label.includes('show') || label.includes('more')) {
          btn.click();
        }
      }
    });
}

interface ClaudeTurn {
  el: Element;
  role: 'user' | 'assistant';
}

function collectClaudeTurns(document: Document): ClaudeTurn[] {
  const seen = new Set<Element>();
  const turns: ClaudeTurn[] = [];

  document.querySelectorAll('[data-testid="user-message"]').forEach((userEl) => {
    if (seen.has(userEl)) return;
    if (!isClaudeChatStreamTurn(userEl)) return;
    seen.add(userEl);
    turns.push({ el: userEl, role: 'user' });
  });

  document.querySelectorAll('.font-claude-response').forEach((el) => {
    if (seen.has(el)) return;
    if (!isClaudeChatStreamTurn(el)) return;
    const nested = turns.some((t) => t.el.contains(el));
    if (nested) return;
    seen.add(el);
    turns.push({ el, role: 'assistant' });
  });

  return sortElementsByDomOrder(turns.map((t) => t.el)).map((el) => {
    if (el.matches('[data-testid="user-message"]') || el.querySelector('[data-testid="user-message"]')) {
      const userEl = el.matches('[data-testid="user-message"]')
        ? el
        : el.querySelector('[data-testid="user-message"]')!;
      return { el: userEl, role: 'user' as const };
    }
    return { el, role: 'assistant' as const };
  });
}

const base = createBaseAdapter({
  id: 'claude',
  label: 'Claude',
  urlPatterns: [/claude\.ai/],
  selectors,
  diagnosticSelectors: [
    { name: 'User messages', selector: '[data-testid="user-message"]' },
    { name: 'Assistant messages', selector: '.font-claude-response' },
  ],
  excludeSelectors,
});

export const claudeAdapter: PlatformAdapter = {
  ...base,

  async extract(document, onProgress, signal) {
    return withCircuitBreaker(async () => {
      onProgress?.({ phase: 'detecting', message: 'Fetching conversation from Claude…', percent: 5 });

      const location = document.location;
      if (location?.href) {
        const viaApi = await extractClaudeViaApi(location, signal).catch(() => null);
        if (viaApi && viaApi.messages.length > 0) {
          enforceTurnLimit(viaApi.messages.length);
          onProgress?.({
            phase: 'done',
            message: `Extracted ${viaApi.messages.length} messages`,
            percent: 100,
          });
          return viaApi;
        }
        console.info('[ChatVault] Claude API extraction unavailable — falling back to page DOM');
      }

      onProgress?.({ phase: 'detecting', message: 'Detecting Claude chat…', percent: 10 });

      const container = findScrollableContainer(
        document,
        selectors.container,
        selectors.message,
      );

      await scrollSweep(container, onProgress, signal);
      expandClaudePasteBlocks(document);

      onProgress?.({ phase: 'waiting', message: 'Loading pasted content and documents…', percent: 30 });
      const hydrationCache = await preExtractHydration(document, onProgress, signal);

      onProgress?.({ phase: 'extracting', message: 'Extracting messages…', percent: 50 });

      const turns = collectClaudeTurns(document);
      const turnEls = filterNestedMessageElements(turns.map((t) => t.el));
      const turnMap = new Map(turns.map((t) => [t.el, t.role]));
      const messages: Message[] = [];
      const priorUserTexts: string[] = [];

      for (let index = 0; index < turnEls.length; index++) {
        const el = turnEls[index];
        const role = turnMap.get(el) ?? (el.matches('[data-testid="user-message"]') ? 'user' : 'assistant');

        if (role === 'user') {
          const userEl = el.matches('[data-testid="user-message"]')
            ? el
            : el.querySelector('[data-testid="user-message"]') ?? el;

          const turn = buildClaudeUserTurnContent(userEl);
          let content = stripSuggestionChipText(turn.text);
          const attachments = extractClaudeUserPastes(userEl, index, hydrationCache);

          if (!content && attachments.length > 0) {
            content = attachments.map((a) => a.content).join('\n\n');
          }
          if (!content) continue;

          messages.push({
            id: generateId('claude', index),
            role: 'user',
            content,
            html: turn.html,
            attachments: attachments.length > 0 ? attachments : undefined,
          });
          priorUserTexts.push(content);
          continue;
        }

        const commentary = extractClaudeAssistantCommentary(el);
        let content = stripSuggestionChipText(commentary.text);
        const attachments = await extractClaudeAssistantArtifacts(
          el,
          document,
          index,
          signal,
          priorUserTexts,
          hydrationCache,
        );

        if (attachments.length > 0) {
          const artifactSections = attachments.map((a) => `## ${a.name}\n\n${a.content}`);
          const artifactText = artifactSections.join('\n\n');
          if (!content.includes(artifactText.slice(0, Math.min(60, artifactText.length)))) {
            content = content ? `${content}\n\n${artifactText}` : artifactText;
          }
        }

        if (!content) continue;

        const hasThinkingChrome = !!el.querySelector('.thinking-block, [data-is-thinking="true"]');
        const isThinking = hasThinkingChrome && !commentary.text.trim();

        messages.push({
          id: generateId('claude', index),
          role: isThinking ? 'reasoning' : 'assistant',
          content,
          html: attachments.length > 0 ? undefined : commentary.html,
          isThinking,
          attachments: attachments.length > 0 ? attachments : undefined,
        });
      }

      const deduped = dedupeMessages(messages);
      enforceTurnLimit(deduped.length);

      const titleCandidates: string[] = [];
      for (const sel of selectors.title) {
        document.querySelectorAll(sel).forEach((node) => {
          const t = node.textContent?.trim();
          if (t) titleCandidates.push(t);
        });
      }
      titleCandidates.push(getPageTitle(document));
      const firstUser = deduped.find((m) => m.role === 'user');
      if (firstUser) {
        titleCandidates.push(normalizeContent(firstUser).slice(0, 100));
      }

      const modelEl = queryAllFirst(document, selectors.model)[0] ?? null;

      onProgress?.({ phase: 'done', message: `Extracted ${deduped.length} messages`, percent: 100 });

      return {
        metadata: {
          title: resolveConversationTitle(titleCandidates, 'Claude'),
          platform: 'claude',
          platformLabel: 'Claude',
          model: modelEl?.textContent?.trim(),
          url: document.location?.href ?? '',
          exportedAt: new Date().toISOString(),
          messageCount: deduped.length,
          source: 'dom',
        },
        messages: deduped,
      } satisfies Conversation;
    }, signal);
  },
};
