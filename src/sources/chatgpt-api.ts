import type { Conversation, Message } from '../core/schema';
import { generateId } from '../core/extract-utils';

/**
 * API-first ChatGPT extraction.
 *
 * chatgpt.com exposes the conversation to its own frontend at
 * /backend-api/conversation/{id}, authorized with the access token returned by
 * /api/auth/session (session cookie). The payload is a branching tree keyed by
 * node id; the active branch is the walk from current_node up to the root.
 * Anything unexpected → return null and let DOM extraction take over.
 */

const API_FETCH_TIMEOUT_MS = 15_000;

/* ------------------------------------------------------------ payload types */

type ChatGptPart = string | { content_type?: string };

interface ChatGptMessageContent {
  content_type?: string;
  parts?: ChatGptPart[];
  text?: string;
  thoughts?: Array<{ summary?: string; content?: string }>;
}

interface ChatGptApiMessage {
  id?: string;
  author?: { role?: string; name?: string };
  create_time?: number | null;
  content?: ChatGptMessageContent;
  recipient?: string;
  metadata?: {
    model_slug?: string;
    is_visually_hidden_from_conversation?: boolean;
  };
}

interface ChatGptNode {
  id?: string;
  parent?: string | null;
  children?: string[];
  message?: ChatGptApiMessage | null;
}

export interface ChatGptApiConversation {
  title?: string;
  current_node?: string;
  mapping?: Record<string, ChatGptNode>;
}

/* ----------------------------------------------------------------- session */

export function getChatGptConversationId(pathname: string): string | undefined {
  return pathname.match(/\/c\/([a-f0-9-]{8,})/i)?.[1];
}

function withTimeout(signal?: AbortSignal): AbortSignal | undefined {
  if (typeof AbortSignal === 'undefined') return signal;
  const timeout =
    typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(API_FETCH_TIMEOUT_MS)
      : undefined;
  if (!timeout) return signal;
  if (!signal) return timeout;
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([signal, timeout]);
  return signal;
}

async function fetchJson<T>(
  url: string,
  signal?: AbortSignal,
  headers: Record<string, string> = {},
): Promise<T | null> {
  try {
    const response = await fetch(url, {
      credentials: 'include',
      headers: { accept: 'application/json', ...headers },
      signal: withTimeout(signal),
    });
    if (!response.ok) return null;
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('json')) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function getAccessToken(origin: string, signal?: AbortSignal): Promise<string | undefined> {
  const session = await fetchJson<{ accessToken?: string }>(`${origin}/api/auth/session`, signal);
  return session?.accessToken || undefined;
}

/* ------------------------------------------------------------------ mapper */

/** Walk parent links from the active leaf to the root → chronological messages. */
export function walkActiveBranch(
  mapping: Record<string, ChatGptNode>,
  currentNode?: string,
): ChatGptApiMessage[] {
  let leafId = currentNode;

  if (!leafId || !mapping[leafId]) {
    // No current_node: pick the leaf with the latest create_time
    const referencedAsParent = new Set<string>();
    for (const node of Object.values(mapping)) {
      (node.children ?? []).forEach((c) => referencedAsParent.add(c));
      if (node.parent) referencedAsParent.add(node.parent);
    }
    let bestTime = -Infinity;
    for (const [id, node] of Object.entries(mapping)) {
      if ((node.children ?? []).length > 0) continue;
      const t = node.message?.create_time ?? 0;
      if (t >= bestTime) {
        bestTime = t;
        leafId = id;
      }
    }
  }

  const chain: ChatGptApiMessage[] = [];
  const guard = new Set<string>();
  let nodeId: string | null | undefined = leafId;
  while (nodeId && mapping[nodeId] && !guard.has(nodeId)) {
    guard.add(nodeId);
    const node: ChatGptNode = mapping[nodeId];
    if (node.message) chain.push(node.message);
    nodeId = node.parent;
  }
  return chain.reverse();
}

function isImagePart(part: ChatGptPart): boolean {
  return (
    typeof part === 'object' &&
    part !== null &&
    (part.content_type ?? '').includes('image')
  );
}

function shouldSkipMessage(msg: ChatGptApiMessage): boolean {
  const role = msg.author?.role ?? '';
  if (msg.metadata?.is_visually_hidden_from_conversation) return true;
  if (msg.recipient && msg.recipient !== 'all') return true;
  return role !== 'user' && role !== 'assistant';
}

export function mapChatGptApiConversation(
  payload: ChatGptApiConversation,
  pageUrl: string,
): Conversation | null {
  if (!payload.mapping || Object.keys(payload.mapping).length === 0) return null;

  const branch = walkActiveBranch(payload.mapping, payload.current_node);
  const messages: Message[] = [];
  let model: string | undefined;

  branch.forEach((apiMsg, index) => {
    if (shouldSkipMessage(apiMsg)) return;
    if (apiMsg.metadata?.model_slug) model = apiMsg.metadata.model_slug;

    const role = apiMsg.author?.role === 'user' ? 'user' : 'assistant';
    const content = apiMsg.content;
    const textParts: string[] = [];
    let hasImageParts = false;

    if (content?.content_type === 'thoughts' && Array.isArray(content.thoughts)) {
      const thinking = content.thoughts
        .map((t) => [t.summary, t.content].filter(Boolean).join('\n'))
        .filter(Boolean)
        .join('\n\n')
        .trim();
      if (thinking) {
        messages.push({
          id: apiMsg.id ?? generateId('chatgpt', index),
          role: 'reasoning',
          content: thinking,
          isThinking: true,
        });
      }
      return;
    }

    if (typeof content?.text === 'string' && content.text.trim()) {
      textParts.push(content.text.trim());
    }

    for (const part of content?.parts ?? []) {
      if (typeof part === 'string') {
        if (part.trim()) textParts.push(part.trim());
      } else if (isImagePart(part)) {
        hasImageParts = true;
      }
    }

    // Images are intentionally not exported; keep a placeholder so the
    // conversation flow stays readable when a turn was only an image.
    let text = textParts.join('\n\n').trim();
    if (!text && hasImageParts) text = '[image attachment omitted]';
    if (!text) return;

    messages.push({
      id: apiMsg.id ?? generateId('chatgpt', index),
      role,
      content: text,
      timestamp: apiMsg.create_time
        ? new Date(apiMsg.create_time * 1000).toISOString()
        : undefined,
    });
  });

  if (messages.length === 0) return null;

  return {
    metadata: {
      title: payload.title?.trim() || undefined,
      platform: 'chatgpt',
      platformLabel: 'ChatGPT',
      model,
      url: pageUrl,
      exportedAt: new Date().toISOString(),
      messageCount: messages.length,
      source: 'api',
    },
    messages,
  };
}

/* ------------------------------------------------------------------ source */

export async function extractChatGptViaApi(
  location: { href: string; origin: string; pathname: string },
  signal?: AbortSignal,
): Promise<Conversation | null> {
  const conversationId = getChatGptConversationId(location.pathname);
  if (!conversationId) return null;

  const token = await getAccessToken(location.origin, signal);
  if (!token) return null;

  const payload = await fetchJson<ChatGptApiConversation>(
    `${location.origin}/backend-api/conversation/${conversationId}`,
    signal,
    { authorization: `Bearer ${token}` },
  );
  if (!payload) return null;

  return mapChatGptApiConversation(payload, location.href);
}
