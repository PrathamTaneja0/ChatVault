import type { Conversation, Message, MessageRole } from '../core/schema';
import type { PlatformAdapter, ProgressCallback, SelectorDiagnostic } from '../core/adapter';
import { dedupeMessages } from '../core/adapter';
import {
  cloneContentWithoutExcluded,
  DEFAULT_ASSISTANT_EXCLUDE_SELECTORS,
  enforceTurnLimit,
  generateId,
  getPageTitle,
  queryAllFirst,
  queryAllMerged,
  scrollSweep,
  withCircuitBreaker,
} from '../core/extract-utils';
import { normalizeContent, resolveConversationTitle, stripSuggestionChipText } from '../core/normalize';

export interface SelectorConfig {
  container: string[];
  message: string[];
  roleUser?: string[];
  roleAssistant?: string[];
  content?: string[];
  title?: string[];
  model?: string[];
  streaming?: string[];
  thinking?: string[];
}

export function createBaseAdapter(config: {
  id: string;
  label: string;
  urlPatterns: RegExp[];
  selectors: SelectorConfig;
  useVirtualScroll?: boolean;
  virtualItemSelector?: string;
  diagnosticSelectors?: Array<{ name: string; selector: string }>;
  excludeSelectors?: string[];
}): PlatformAdapter {
  const { id, label, urlPatterns, selectors, useVirtualScroll, virtualItemSelector, diagnosticSelectors, excludeSelectors } = config;

  return {
    id,
    label,
    urlPatterns,

    matches(url: string) {
      return urlPatterns.some((p) => p.test(url));
    },

    getSelectorDiagnostics(document: Document): SelectorDiagnostic[] {
      const checks: Array<{ name: string; selector: string }> = [
        { name: 'Container', selector: selectors.container[0] ?? '' },
        ...(diagnosticSelectors ?? [{ name: 'Messages', selector: selectors.message[0] ?? '' }]),
        ...(selectors.content?.[0] ? [{ name: 'Content', selector: selectors.content[0] }] : []),
      ];
      return checks.map(({ name, selector }) => {
        const els = document.querySelectorAll(selector);
        return { name, selector, found: els.length > 0, count: els.length };
      });
    },

    async extract(document, onProgress, signal) {
      return withCircuitBreaker(async () => {
        onProgress?.({ phase: 'detecting', message: `Detecting ${label} chat…`, percent: 0 });

        const container = queryAllFirst(document, selectors.container)[0]
          ?? document.querySelector(selectors.container[0] ?? 'body')
          ?? document.body;

        if (useVirtualScroll && virtualItemSelector) {
          const { virtualScrollSweep } = await import('../core/extract-utils');
          await virtualScrollSweep(container, virtualItemSelector, onProgress, signal);
        } else {
          await scrollSweep(container, onProgress, signal);
        }

        onProgress?.({ phase: 'extracting', message: 'Extracting messages…', percent: 50 });

        const messageEls = queryAllMerged(document, selectors.message);
        const messages: Message[] = [];

        messageEls.forEach((el, index) => {
          const role = detectRole(el, selectors, index);
          const contentEl = selectors.content
            ? queryAllFirst(el, selectors.content)[0] ?? el
            : el;

          const excludeList = [
            ...(role === 'assistant' ? DEFAULT_ASSISTANT_EXCLUDE_SELECTORS : []),
            ...(excludeSelectors ?? []),
          ];
          const clone = cloneContentWithoutExcluded(contentEl, excludeList);
          const html = clone.innerHTML;
          let content = clone.textContent?.trim() ?? '';
          content = stripSuggestionChipText(content);

          if (!content) return;

          const isThinking = selectors.thinking?.some((s) => el.matches(s) || el.querySelector(s)) ?? false;

          messages.push({
            id: generateId(id, index),
            role: isThinking ? 'reasoning' : role,
            content,
            html,
            isThinking,
          });
        });

        const deduped = dedupeMessages(messages);
        enforceTurnLimit(deduped.length);

        const titleCandidates: string[] = [];
        if (selectors.title) {
          for (const sel of selectors.title) {
            document.querySelectorAll(sel).forEach((el) => {
              const t = el.textContent?.trim();
              if (t) titleCandidates.push(t);
            });
          }
        }
        titleCandidates.push(getPageTitle(document));
        const firstUser = deduped.find((m) => m.role === 'user');
        if (firstUser) {
          titleCandidates.push(normalizeContent(firstUser).slice(0, 100));
        }

        const modelEl = selectors.model ? queryAllFirst(document, selectors.model)[0] : null;

        onProgress?.({ phase: 'done', message: `Extracted ${deduped.length} messages`, percent: 100 });

        const conversation: Conversation = {
          metadata: {
            title: resolveConversationTitle(titleCandidates, label),
            platform: id,
            platformLabel: label,
            model: modelEl?.textContent?.trim(),
            url: document.location?.href ?? '',
            exportedAt: new Date().toISOString(),
            messageCount: deduped.length,
          },
          messages: deduped,
        };

        return conversation;
      }, signal);
    },
  };
}

function detectRole(el: Element, selectors: SelectorConfig, index: number): MessageRole {
  if (selectors.roleUser?.some((s) => el.matches(s) || el.querySelector(s))) return 'user';
  if (selectors.roleAssistant?.some((s) => el.matches(s) || el.querySelector(s))) return 'assistant';

  const dataRole = el.getAttribute('data-message-author-role');
  if (dataRole === 'user') return 'user';
  if (dataRole === 'assistant') return 'assistant';

  const ariaLabel = el.getAttribute('aria-label')?.toLowerCase() ?? '';
  if (ariaLabel.includes('user') || ariaLabel.includes('you')) return 'user';
  if (ariaLabel.includes('assistant') || ariaLabel.includes('chatgpt') || ariaLabel.includes('claude')) return 'assistant';

  return index % 2 === 0 ? 'user' : 'assistant';
}
