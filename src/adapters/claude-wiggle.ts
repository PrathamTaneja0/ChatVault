const MIN_ARTIFACT_BODY_LEN = 100;

function normalizeCacheKey(key: string): string {
  return key.replace(/\s+/g, ' ').trim().toLowerCase();
}

interface SandboxFileMetadata {
  path: string;
}

interface ListFilesResponse {
  files?: string[];
  files_metadata?: SandboxFileMetadata[];
}

let cachedOrgId: string | undefined;
let cachedConversationId: string | undefined;
let cachedOutputPaths: string[] | undefined;

export function resetClaudeWiggleCache(): void {
  cachedOrgId = undefined;
  cachedConversationId = undefined;
  cachedOutputPaths = undefined;
}

function getOrgIdFromCookie(): string | undefined {
  const match = document.cookie.match(/(?:^|;\s*)lastActiveOrg=([^;]+)/);
  return match?.[1]?.trim() || undefined;
}

function getConversationId(): string | undefined {
  const match = window.location.pathname.match(/\/chat\/([a-f0-9-]+)/i);
  return match?.[1];
}

async function resolveOrgId(signal?: AbortSignal): Promise<string | undefined> {
  const fromCookie = getOrgIdFromCookie();
  if (fromCookie) {
    cachedOrgId = fromCookie;
    return fromCookie;
  }
  if (cachedOrgId) return cachedOrgId;

  try {
    const response = await fetch(`${window.location.origin}/api/organizations`, {
      credentials: 'include',
      signal,
    });
    if (!response.ok) return undefined;
    const data = (await response.json()) as
      | Array<{ uuid?: string; id?: string }>
      | { data?: Array<{ uuid?: string; id?: string }> };
    const orgs = Array.isArray(data) ? data : (data.data ?? []);
    const orgId = orgs[0]?.uuid ?? orgs[0]?.id;
    if (orgId) cachedOrgId = orgId;
    return orgId;
  } catch {
    return undefined;
  }
}

function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeStem(stem: string): string {
  return normalizeCacheKey(stem.replace(/[-_]+/g, ' '));
}

function basenameFromPath(path: string): string {
  return path.split('/').pop() ?? path;
}

export function matchOutputPathForTitle(title: string, paths: string[]): string | undefined {
  const outputs = paths.filter((path) => path.includes('/outputs/'));
  if (!outputs.length) return undefined;

  const normalizedTitle = normalizeCacheKey(title);
  const titleSlug = slugifyTitle(title);

  for (const path of outputs) {
    const stem = basenameFromPath(path).replace(/\.[^.]+$/, '');
    if (normalizeStem(stem) === normalizedTitle) return path;
  }

  for (const path of outputs) {
    const stemSlug = slugifyTitle(basenameFromPath(path).replace(/\.[^.]+$/, ''));
    if (stemSlug && titleSlug && (stemSlug === titleSlug || stemSlug.includes(titleSlug) || titleSlug.includes(stemSlug))) {
      return path;
    }
  }

  if (titleSlug.length >= 8) {
    for (const path of outputs) {
      const base = basenameFromPath(path).toLowerCase();
      if (base.includes(titleSlug.slice(0, Math.min(titleSlug.length, 24)))) return path;
    }
  }

  return outputs.length === 1 ? outputs[0] : undefined;
}

async function listConversationOutputPaths(signal?: AbortSignal): Promise<string[]> {
  const conversationId = getConversationId();
  if (!conversationId) return [];

  if (cachedOutputPaths && cachedConversationId === conversationId) {
    return cachedOutputPaths;
  }

  const orgId = await resolveOrgId(signal);
  if (!orgId) return [];

  try {
    const url = `${window.location.origin}/api/organizations/${orgId}/conversations/${conversationId}/wiggle/list-files?prefix=`;
    const response = await fetch(url, { credentials: 'include', signal });
    if (!response.ok) return [];

    const data = (await response.json()) as ListFilesResponse;
    const paths =
      data.files_metadata?.map((entry) => entry.path) ??
      data.files ??
      [];

    cachedConversationId = conversationId;
    cachedOutputPaths = paths.filter((path) => path.includes('/outputs/'));
    return cachedOutputPaths;
  } catch {
    return [];
  }
}

async function fetchWiggleFile(path: string, signal?: AbortSignal): Promise<string> {
  const conversationId = getConversationId();
  const orgId = (await resolveOrgId(signal)) ?? cachedOrgId;
  if (!conversationId || !orgId) return '';

  const url = `${window.location.origin}/api/organizations/${orgId}/conversations/${conversationId}/wiggle/download-file?path=${encodeURIComponent(path)}`;
  try {
    const response = await fetch(url, { credentials: 'include', signal });
    if (!response.ok) return '';
    const text = await response.text();
    return text.trim().length >= MIN_ARTIFACT_BODY_LEN ? text.trim() : '';
  } catch {
    return '';
  }
}

/** Fetch artifact body via Claude's wiggle API (no browser download dialog). */
export async function fetchArtifactViaWiggleApi(
  title: string,
  signal?: AbortSignal,
): Promise<string> {
  const paths = await listConversationOutputPaths(signal);
  const path = matchOutputPathForTitle(title, paths);
  if (!path) return '';
  return fetchWiggleFile(path, signal);
}
