import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  fetchArtifactViaWiggleApi,
  matchOutputPathForTitle,
  resetClaudeWiggleCache,
} from '../../src/adapters/claude-wiggle';

const FULL_ARTIFACT = `# Identität & Persönlichkeit

Du bist Thomas Meyer, ein Hilti-Kunde der wegen eines Preisproblems anruft.`;

describe('claude-wiggle', () => {
  beforeEach(() => {
    resetClaudeWiggleCache();
    vi.restoreAllMocks();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        origin: 'https://claude.ai',
        pathname: '/chat/conv-uuid-123',
      },
    });
    document.cookie = 'lastActiveOrg=org-uuid-456';
  });

  it('matches artifact titles to output paths', () => {
    const paths = [
      '/mnt/user-data/uploads/notes.md',
      '/mnt/user-data/outputs/hilti-vapi-prompt-deutsch.md',
    ];
    expect(matchOutputPathForTitle('Hilti vapi prompt deutsch', paths)).toBe(
      '/mnt/user-data/outputs/hilti-vapi-prompt-deutsch.md',
    );
  });

  it('fetches artifact content via wiggle API without clicking Download', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('list-files')) {
        return {
          ok: true,
          json: async () => ({
            files_metadata: [
              { path: '/mnt/user-data/outputs/hilti-vapi-prompt-deutsch.md' },
            ],
          }),
        };
      }
      if (url.includes('download-file')) {
        return {
          ok: true,
          text: async () => FULL_ARTIFACT,
        };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const content = await fetchArtifactViaWiggleApi('Hilti vapi prompt deutsch');
    expect(content).toContain('Thomas Meyer');
    expect(fetchMock).toHaveBeenCalled();
    expect(
      fetchMock.mock.calls.some((call) => String(call[0]).includes('wiggle/download-file')),
    ).toBe(true);
    expect(
      fetchMock.mock.calls.some((call) => String(call[0]).includes('artifact-block')),
    ).toBe(false);
  });
});
