import type { Attachment, Conversation, Message } from '../core/schema';
import { generateId } from '../core/extract-utils';

/**
 * API-first Claude extraction.
 *
 * claude.ai's own frontend loads conversations from a same-origin REST API using
 * the session cookie. Reading that JSON gives the exact conversation content —
 * full pasted text, artifacts, thinking blocks, and image references — with no
 * DOM scraping, clicking, or clipboard access. Every field access is defensive:
 * if the payload shape changes, we return null and the DOM fallback takes over.
 */

const API_FETCH_TIMEOUT_MS = 15_000;

/* ---------------------------------- payload types (all optional/defensive) */

interface ClaudeContentBlock {
  type?: string;
  text?: string;
  thinking?: string;
  name?: string;
  input?: {
    command?: string;
    id?: string;
    title?: string;
    type?: string;
    language?: string;
    content?: string;
    old_str?: string;
    new_str?: string;
  };
}

interface ClaudeAttachmentEntry {
  file_name?: string;
  file_type?: string;
  extracted_content?: string;
}

interface ClaudeFileEntry {
  file_kind?: string;
  kind?: string;
  file_uuid?: string;
  uuid?: string;
  file_name?: string;
  preview_url?: string;
  thumbnail_url?: string;
  preview_asset?: { url?: string };
  thumbnail_asset?: { url?: string };
}

interface ClaudeApiMessage {
  uuid?: string;
  text?: string;
  sender?: string;
  index?: number;
  created_at?: string;
  content?: ClaudeContentBlock[];
  attachments?: ClaudeAttachmentEntry[];
  files?: ClaudeFileEntry[];
  files_v2?: ClaudeFileEntry[];
}

export interface ClaudeApiConversation {
  uuid?: string;
  name?: string;
  model?: string;
  chat_messages?: ClaudeApiMessage[];
}

/* --------------------------------------------------------------- session */

export function getClaudeConversationId(pathname: string): string | undefined {
  return pathname.match(/\/chat\/([a-f0-9-]{8,})/i)?.[1];
}

function getOrgIdFromCookie(cookie: string): string | undefined {
  return cookie.match(/(?:^|;\s*)lastActiveOrg=([^;]+)/)?.[1]?.trim() || undefined;
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

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T | null> {
  try {
    const response = await fetch(url, {
      credentials: 'include',
      headers: { accept: 'application/json' },
      signal: withTimeout(signal),
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function resolveOrgId(origin: string, signal?: AbortSignal): Promise<string | undefined> {
  const fromCookie = getOrgIdFromCookie(typeof document !== 'undefined' ? document.cookie : '');
  if (fromCookie) return fromCookie;

  const data = await fetchJson<Array<{ uuid?: string; id?: string }> | { data?: Array<{ uuid?: string; id?: string }> }>(
    `${origin}/api/organizations`,
    signal,
  );
  if (!data) return undefined;
  const orgs = Array.isArray(data) ? data : (data.data ?? []);
  return orgs[0]?.uuid ?? orgs[0]?.id;
}

/* ---------------------------------------------------------------- mapper */

function artifactMimeType(block: ClaudeContentBlock): string {
  const type = block.input?.type ?? '';
  if (type.includes('/')) return type;
  return 'text/markdown';
}

/** Apply create/rewrite/update artifact commands in stream order, keyed by artifact id. */
class ArtifactAccumulator {
  private readonly byId = new Map<string, { title: string; content: string; mimeType: string }>();
  private readonly order: string[] = [];

  apply(block: ClaudeContentBlock): void {
    const input = block.input;
    if (!input) return;
    const id = input.id ?? input.title ?? `artifact-${this.order.length}`;
    const command = input.command ?? 'create';

    if (command === 'create' || command === 'rewrite') {
      if (!this.byId.has(id)) this.order.push(id);
      this.byId.set(id, {
        title: input.title ?? this.byId.get(id)?.title ?? 'Artifact',
        content: input.content ?? '',
        mimeType: artifactMimeType(block),
      });
      return;
    }

    if (command === 'update') {
      const existing = this.byId.get(id);
      if (existing && input.old_str !== undefined && input.new_str !== undefined) {
        existing.content = existing.content.replace(input.old_str, input.new_str);
      } else if (existing && input.content) {
        existing.content = input.content;
      } else if (!existing && input.content) {
        this.order.push(id);
        this.byId.set(id, {
          title: input.title ?? 'Artifact',
          content: input.content,
          mimeType: artifactMimeType(block),
        });
      }
    }
  }

  toAttachments(messageIndex: number): Attachment[] {
    return this.order
      .map((id) => this.byId.get(id))
      .filter((a): a is { title: string; content: string; mimeType: string } => !!a && !!a.content.trim())
      .map((a, i) => ({
        id: generateId('claude-artifact', messageIndex * 10 + i),
        kind: 'artifact' as const,
        name: a.title,
        content: a.content,
        mimeType: a.mimeType,
      }));
  }
}

function mapPasteAttachments(entries: ClaudeAttachmentEntry[] | undefined, messageIndex: number): Attachment[] {
  if (!entries?.length) return [];
  return entries
    .filter((entry) => entry.extracted_content?.trim())
    .map((entry, i) => ({
      id: generateId('claude-paste', messageIndex * 10 + i),
      kind: 'paste' as const,
      name: entry.file_name ?? 'Pasted content',
      content: entry.extracted_content!.trim(),
      mimeType: entry.file_type,
    }));
}

function resolveFileUrl(entry: ClaudeFileEntry, origin: string): string | undefined {
  const raw =
    entry.preview_url ??
    entry.preview_asset?.url ??
    entry.thumbnail_url ??
    entry.thumbnail_asset?.url;
  if (!raw) return undefined;
  try {
    return raw.startsWith('http') ? raw : new URL(raw, origin).href;
  } catch {
    return undefined;
  }
}

function isImageFileEntry(entry: ClaudeFileEntry): boolean {
  const kind = (entry.file_kind ?? entry.kind ?? '').toLowerCase();
  if (kind === 'image') return true;
  const name = (entry.file_name ?? '').toLowerCase();
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/.test(name);
}

function mapImageAttachments(message: ClaudeApiMessage, origin: string, messageIndex: number): Attachment[] {
  const entries = [...(message.files ?? []), ...(message.files_v2 ?? [])];
  const attachments: Attachment[] = [];
  const seen = new Set<string>();

  entries.forEach((entry) => {
    if (!isImageFileEntry(entry)) return;
    const sourceUrl = resolveFileUrl(entry, origin);
    if (!sourceUrl || seen.has(sourceUrl)) return;
    seen.add(sourceUrl);
    attachments.push({
      id: generateId('claude-image', messageIndex * 10 + attachments.length),
      kind: 'image',
      name: entry.file_name ?? 'Image',
      content: entry.file_name ?? 'Image',
      sourceUrl,
    });
  });

  return attachments;
}

export function mapClaudeApiConversation(
  payload: ClaudeApiConversation,
  pageUrl: string,
): Conversation | null {
  const apiMessages = payload.chat_messages;
  if (!Array.isArray(apiMessages) || apiMessages.length === 0) return null;

  let origin = 'https://claude.ai';
  try {
    origin = new URL(pageUrl).origin;
  } catch {
    /* keep default */
  }

  const ordered = [...apiMessages].sort((a, b) => {
    if (typeof a.index === 'number' && typeof b.index === 'number') return a.index - b.index;
    return 0;
  });

  const messages: Message[] = [];

  ordered.forEach((apiMsg, index) => {
    const role = apiMsg.sender === 'human' ? 'user' : 'assistant';
    const textParts: string[] = [];
    const thinkingParts: string[] = [];
    const artifacts = new ArtifactAccumulator();

    if (Array.isArray(apiMsg.content) && apiMsg.content.length > 0) {
      for (const block of apiMsg.content) {
        if (!block || typeof block !== 'object') continue;
        if (block.type === 'text' && block.text) {
          textParts.push(block.text);
        } else if (block.type === 'thinking' && block.thinking) {
          thinkingParts.push(block.thinking);
        } else if (block.type === 'tool_use' && block.name === 'artifacts') {
          artifacts.apply(block);
        }
      }
    } else if (apiMsg.text) {
      textParts.push(apiMsg.text);
    }

    const attachments: Attachment[] = [
      ...mapPasteAttachments(apiMsg.attachments, index),
      ...mapImageAttachments(apiMsg, origin, index),
      ...(role === 'assistant' ? artifacts.toAttachments(index) : []),
    ];

    const thinking = thinkingParts.join('\n\n').trim();
    if (thinking) {
      messages.push({
        id: apiMsg.uuid ? `${apiMsg.uuid}-thinking` : generateId('claude', index * 2),
        role: 'reasoning',
        content: thinking,
        isThinking: true,
        timestamp: apiMsg.created_at,
      });
    }

    let content = textParts.join('\n\n').trim();
    if (!content && attachments.length > 0) {
      content =
        role === 'user'
          ? attachments.map((a) => a.name ?? 'Attachment').join(', ')
          : '';
    }
    if (!content && attachments.length === 0) return;

    messages.push({
      id: apiMsg.uuid ?? generateId('claude', index * 2 + 1),
      role,
      content,
      timestamp: apiMsg.created_at,
      attachments: attachments.length > 0 ? attachments : undefined,
    });
  });

  if (messages.length === 0) return null;

  return {
    metadata: {
      title: payload.name?.trim() || undefined,
      platform: 'claude',
      platformLabel: 'Claude',
      model: payload.model,
      url: pageUrl,
      exportedAt: new Date().toISOString(),
      messageCount: messages.length,
      source: 'api',
    },
    messages,
  };
}

/* ---------------------------------------------------------------- source */

/**
 * Fetch the current conversation via the claude.ai API.
 * Returns null whenever anything is off (not a chat URL, logged out, payload
 * shape unknown) so callers can fall back to DOM extraction.
 */
export async function extractClaudeViaApi(
  location: { href: string; origin: string; pathname: string },
  signal?: AbortSignal,
): Promise<Conversation | null> {
  const conversationId = getClaudeConversationId(location.pathname);
  if (!conversationId) return null;

  const orgId = await resolveOrgId(location.origin, signal);
  if (!orgId) return null;

  const base = `${location.origin}/api/organizations/${orgId}/chat_conversations/${conversationId}`;
  const payload =
    (await fetchJson<ClaudeApiConversation>(
      `${base}?tree=True&rendering_mode=messages&render_all_tools=true`,
      signal,
    )) ?? (await fetchJson<ClaudeApiConversation>(base, signal));

  if (!payload) return null;
  return mapClaudeApiConversation(payload, location.href);
}
