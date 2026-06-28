import type { Conversation, Message } from '../core/schema';
import type { PlatformAdapter } from '../core/adapter';
import { dedupeMessages } from '../core/adapter';
import {
  cloneContentWithoutExcluded,
  DEFAULT_ASSISTANT_EXCLUDE_SELECTORS,
  enforceTurnLimit,
  filterNestedMessageElements,
  generateId,
  getPageTitle,
  queryAllFirst,
  queryAllMerged,
  scrollSweep,
  withCircuitBreaker,
} from '../core/extract-utils';
import { normalizeContent, resolveConversationTitle, stripSuggestionChipText } from '../core/normalize';
import { detectRole, matchesRoleSelector } from './base';
import {
  buildClaudeUserTurnContent,
  extractClaudeAssistantArtifacts,
  extractClaudeUserPastes,
} from './claude-extract';
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
  thinking: ['.thinking-block', '[data-is-thinking]'],
};

const excludeSelectors = [
  'button[data-testid="action-bar-copy"]',
  '[data-testid="action-bar"]',
  '[aria-label="Message actions"]',
];

function expandClaudePasteBlocks(document: Document): void {
  document.querySelectorAll('.artifact-block-cell button, [class*="PASTED"] button').forEach((btn) => {
    if (btn instanceof HTMLButtonElement) {
      const label = btn.getAttribute('aria-label')?.toLowerCase() ?? btn.textContent?.toLowerCase() ?? '';
      if (label.includes('expand') || label.includes('show') || label.includes('more')) {
        btn.click();
      }
    }
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
      onProgress?.({ phase: 'detecting', message: 'Detecting Claude chat…', percent: 0 });

      const container = queryAllFirst(document, selectors.container)[0]
        ?? document.querySelector('main')
        ?? document.body;

      await scrollSweep(container, onProgress, signal);
      expandClaudePasteBlocks(document);

      onProgress?.({ phase: 'extracting', message: 'Extracting messages…', percent: 50 });

      const messageEls = filterNestedMessageElements(queryAllMerged(document, selectors.message));
      const messages: Message[] = [];

      for (let index = 0; index < messageEls.length; index++) {
        const el = messageEls[index];
        const role = detectRole(el, selectors, index);

        if (role === 'user' && el.matches('[data-testid="user-message"]')) {
          const turn = buildClaudeUserTurnContent(el);
          let content = stripSuggestionChipText(turn.text);
          const attachments = extractClaudeUserPastes(el, index);
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
          continue;
        }

        if (role === 'assistant') {
          const contentEl =
            queryAllFirst(el, selectors.content)[0] ?? el;
          const excludeList = [...DEFAULT_ASSISTANT_EXCLUDE_SELECTORS, ...excludeSelectors];
          const clone = cloneContentWithoutExcluded(contentEl, excludeList);
          let content = stripSuggestionChipText(clone.textContent?.trim() ?? '');
          const attachments = await extractClaudeAssistantArtifacts(el, document, index, signal);

          if (attachments.length > 0) {
            const artifactText = attachments.map((a) => a.content).join('\n\n');
            if (!content.includes(artifactText.slice(0, 60))) {
              content = content ? `${content}\n\n${artifactText}` : artifactText;
            }
          }

          if (!content) continue;

          const isThinking =
            selectors.thinking?.some((s) => el.matches(s) || el.querySelector(s)) ?? false;

          messages.push({
            id: generateId('claude', index),
            role: isThinking ? 'reasoning' : 'assistant',
            content,
            html: clone.innerHTML,
            isThinking,
            attachments: attachments.length > 0 ? attachments : undefined,
          });
          continue;
        }

        if (matchesRoleSelector(el, selectors.roleUser)) {
          const turn = buildClaudeUserTurnContent(el);
          const content = stripSuggestionChipText(turn.text);
          if (!content) continue;
          messages.push({
            id: generateId('claude', index),
            role: 'user',
            content,
            html: turn.html,
          });
        }
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
        },
        messages: deduped,
      } satisfies Conversation;
    }, signal);
  },
};
