import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { claudeAdapter } from '../../src/adapters/claude';
import {
  HydratedContentCache,
  cacheKeyForArtifact,
  cacheKeyForPaste,
  findPasteContentPanel,
  findViewArtifactButton,
  isClaudeChatStreamTurn,
  readPastePanelDom,
} from '../../src/adapters/claude-hydrate';
import {
  collectPasteNodesInTurn,
  extractClaudeAssistantCommentary,
  extractPastePreviewFromNode,
  findClaudeUserTurnRoot,
} from '../../src/adapters/claude-extract';

const FULL_PASTE = `# Identity & Personality

You are a realistic roleplay simulator built for sales training at Hilti.
You play exclusively the role of Thomas Meyer, an existing Hilti customer who calls a Hilti sales advisor about a current price concern. The user you are speaking with is the Hilti sales advisor. This is a long pasted prompt body used for export testing and must exceed the preview truncation threshold so hydration can distinguish preview from full content. Additional guardrails and scoring criteria follow below for the roleplay training scenario.`;

const FULL_ARTIFACT = `# Identität & Persönlichkeit

Du bist Thomas Meyer, ein Hilti-Kunde der wegen eines Preisproblems anruft.
Du spielst ausschließlich die Rolle des Kunden in diesem Verkaufstrainingsszenario.
Dies ist ein ausführlicher deutscher Vapi-Prompt für den Export-Test mit genügend Text.`;

describe('claudeAdapter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <main>
        <div data-testid="user-message">
          <div class="!font-user-message">What is ADHD housing?</div>
        </div>
        <div class="font-claude-response" data-is-streaming="false">
          <div class="standard-markdown">
            <p>Universities offer several accommodation options.</p>
          </div>
          <button data-testid="action-bar-copy">Copy</button>
        </div>
        <div data-testid="user-message">
          <div class="!font-user-message">Tell me more</div>
        </div>
        <div class="font-claude-response">
          <div class="standard-markdown">
            <p>Here are more details about housing.</p>
          </div>
        </div>
      </main>
    `;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('extracts both user and assistant messages from current Claude DOM', async () => {
    const promise = claudeAdapter.extract(document);
    await vi.runAllTimersAsync();
    const conversation = await promise;
    expect(conversation.messages).toHaveLength(4);
    expect(conversation.messages.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
    ]);
    expect(conversation.messages[1].content).toContain('accommodation options');
    expect(conversation.messages[3].content).toContain('more details');
  });

  it('includes pasted content from artifact blocks in user messages', async () => {
    document.body.innerHTML = `
      <main>
        <div data-testid="user-message">
          <div class="!font-user-message">translate this prompt</div>
          <div class="artifact-block-cell">
            <pre># Identity & Personality\nYou are a realistic roleplay simulator...</pre>
          </div>
        </div>
        <div class="font-claude-response">
          <div class="standard-markdown"><p>German translation below.</p></div>
        </div>
      </main>
    `;

    const promise = claudeAdapter.extract(document);
    await vi.runAllTimersAsync();
    const conversation = await promise;

    expect(conversation.messages[0].role).toBe('user');
    expect(conversation.messages[0].content).toContain('roleplay simulator');
    expect(conversation.messages[0].attachments?.length).toBeGreaterThan(0);
  });

  it('includes external PASTED card preceding the user message', async () => {
    document.body.innerHTML = `
      <main>
        <div class="paste-preview-card">
          <span class="PASTED">PASTED</span>
          <pre># Identity & Personality\nYou are a realistic roleplay simulator for Hilti sales training...</pre>
        </div>
        <div data-testid="user-message">
          <div class="!font-user-message">translate this vapi prompt to german</div>
        </div>
        <div class="font-claude-response">
          <div class="standard-markdown"><p>Translation notes below.</p></div>
        </div>
      </main>
    `;

    const promise = claudeAdapter.extract(document);
    await vi.runAllTimersAsync();
    const conversation = await promise;

    expect(conversation.messages[0].content).toContain('roleplay simulator');
    expect(conversation.messages[0].content).toContain('translate this vapi prompt');
  });

  it('includes paste inside turn wrapper (not direct sibling)', async () => {
    document.body.innerHTML = `
      <main>
        <div data-test-render-count="1" class="grid group">
          <div class="flex flex-col">
            <div class="paste-preview-card artifact-block-cell">
              <pre># Identity & Personality\nYou are a realistic roleplay simulator for Hilti...</pre>
              <span class="PASTED">PASTED</span>
            </div>
            <div data-testid="user-message">
              <div class="!font-user-message">translate this vapi prompt to german</div>
            </div>
          </div>
        </div>
        <div class="font-claude-response">
          <div class="standard-markdown"><p>Notes.</p></div>
        </div>
      </main>
    `;

    const userEl = document.querySelector('[data-testid="user-message"]')!;
    const turnRoot = findClaudeUserTurnRoot(userEl);
    const pasteNodes = collectPasteNodesInTurn(turnRoot, userEl);
    expect(pasteNodes.length).toBeGreaterThan(0);

    const promise = claudeAdapter.extract(document);
    await vi.runAllTimersAsync();
    const conversation = await promise;

    expect(conversation.messages[0].content).toContain('roleplay simulator');
    expect(conversation.messages[0].content.indexOf('roleplay simulator')).toBeLessThan(
      conversation.messages[0].content.indexOf('translate this vapi prompt'),
    );
  });

  it('collects file-thumbnail paste nodes in live-shaped turn', () => {
    document.body.innerHTML = `
      <main>
        <div data-test-render-count="2" class="group">
          <div class="gap-2 flex-wrap">
            <div data-testid="file-thumbnail">
              <button aria-label="Pasted Text, pasted, 191 lines">preview</button>
            </div>
          </div>
          <div data-testid="user-message"><div>translate prompt</div></div>
        </div>
      </main>
    `;
    const userEl = document.querySelector('[data-testid="user-message"]')!;
    const nodes = collectPasteNodesInTurn(findClaudeUserTurnRoot(userEl), userEl);
    expect(nodes.some((n) => n.matches('[data-testid="file-thumbnail"]'))).toBe(true);
  });

  it('prefers View overlay button over Download for artifact cards', () => {
    document.body.innerHTML = `
      <div class="group/artifact-block">
        <button class="absolute inset-0" aria-label="View Hilti vapi prompt deutsch"></button>
        <div class="artifact-block-cell">
          <button aria-label="Download Hilti vapi prompt deutsch">Download</button>
        </div>
      </div>
    `;
    const card = document.querySelector('.group\\/artifact-block') as HTMLElement;
    const target = findViewArtifactButton(card);
    expect(target.getAttribute('aria-label')).toMatch(/^View /);
  });

  it('includes assistant artifact document body from open panel', async () => {
    document.body.innerHTML = `
      <main>
        <div data-testid="user-message">
          <div class="!font-user-message">translate prompt</div>
        </div>
        <div class="font-claude-response">
          <div class="standard-markdown"><p>Here is the German version.</p></div>
          <div class="group/artifact-block">
            <button class="absolute inset-0" aria-label="View Hilti vapi prompt deutsch"></button>
            <div class="artifact-block-cell" data-testid="artifact-card">
              <span class="artifact-title">Hilti vapi prompt deutsch</span>
              Document · MD
            </div>
          </div>
        </div>
        <aside class="artifact-panel split-view">
          <button aria-label="Copy document">Copy</button>
          <div class="standard-markdown">
            <h1>Identität & Persönlichkeit</h1>
            <p>Du bist Thomas Meyer, ein Hilti-Kunde der wegen eines Preisproblems anruft.</p>
          </div>
        </aside>
      </main>
    `;

    const promise = claudeAdapter.extract(document);
    await vi.runAllTimersAsync();
    const conversation = await promise;

    expect(conversation.messages[1].content).toContain('Identität');
    expect(conversation.messages[1].content).toContain('Thomas Meyer');
    expect(conversation.messages[1].content).toContain('Here is the German version');
  });

  it('rejects label-only artifacts when panel body is unavailable', async () => {
    document.body.innerHTML = `
      <main>
        <div data-testid="user-message">
          <div class="!font-user-message">go</div>
        </div>
        <div class="font-claude-response">
          <div class="standard-markdown"><p>Done.</p></div>
          <div class="group/artifact-block">
            <button class="absolute inset-0" aria-label="View Hilti vapi prompt deutsch"></button>
            <div class="artifact-block-cell" data-testid="artifact-card">Hilti vapi prompt deutsch Document · MD</div>
          </div>
        </div>
      </main>
    `;

    const promise = claudeAdapter.extract(document);
    await vi.runAllTimersAsync();
    const conversation = await promise;

    expect(conversation.messages[1].content).toBe('Done.');
    expect(conversation.messages[1].attachments).toBeUndefined();
  });

  it('uses panel Copy button (not message action-bar-copy) for artifacts', async () => {
    const readText = vi.fn().mockResolvedValue(FULL_ARTIFACT);
    vi.stubGlobal('navigator', {
      ...globalThis.navigator,
      clipboard: { readText },
    });

    document.body.innerHTML = `
      <main>
        <div data-testid="user-message">
          <div class="!font-user-message">translate</div>
        </div>
        <div class="font-claude-response">
          <div class="standard-markdown"><p>Notes.</p></div>
          <div class="group/artifact-block">
            <button class="absolute inset-0" aria-label="View Hilti vapi prompt deutsch"></button>
            <div class="artifact-block-cell" data-testid="artifact-card">Hilti vapi prompt deutsch Document · MD</div>
          </div>
          <button data-testid="action-bar-copy">Copy message</button>
        </div>
        <aside class="artifact-panel split-view">
          <button aria-label="Copy document">Copy</button>
        </aside>
      </main>
    `;

    const promise = claudeAdapter.extract(document);
    await vi.runAllTimersAsync();
    const conversation = await promise;

    expect(conversation.messages[1].content).toContain('Thomas Meyer');
    expect(readText).toHaveBeenCalled();
  });

  it('uses download-file fetch fallback for artifacts', async () => {
    const downloadUrl = 'https://claude.ai/api/download-file?path=hilti.md';
    const originalFetch = globalThis.fetch.bind(globalThis);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('download-file')) {
        return {
          ok: true,
          clone: () => ({ text: async () => FULL_ARTIFACT }),
          text: async () => FULL_ARTIFACT,
        };
      }
      return originalFetch(input);
    });
    vi.stubGlobal('fetch', fetchMock);

    document.body.innerHTML = `
      <main>
        <div data-testid="user-message">
          <div class="!font-user-message">translate</div>
        </div>
        <div class="font-claude-response">
          <div class="standard-markdown"><p>Notes.</p></div>
          <div class="group/artifact-block">
            <button class="absolute inset-0" aria-label="View Hilti vapi prompt deutsch"></button>
            <div class="artifact-block-cell" data-testid="artifact-card">
              Hilti vapi prompt deutsch Document · MD
              <button aria-label="Download Hilti vapi prompt deutsch">Download</button>
            </div>
          </div>
        </div>
      </main>
    `;

    // Simulate Claude triggering download-file when Download is clicked during hydration
    const downloadBtn = document.querySelector('button[aria-label*="Download"]')!;
    downloadBtn.addEventListener('click', () => {
      void window.fetch(downloadUrl);
    });

    const promise = claudeAdapter.extract(document);
    await vi.runAllTimersAsync();
    const conversation = await promise;

    expect(conversation.messages[1].attachments?.[0]?.content).toContain('Thomas Meyer');
  });

  it('uses hydrated cache for truncated paste thumbnail preview', async () => {
    const readText = vi.fn().mockResolvedValue(FULL_PASTE);
    vi.stubGlobal('navigator', {
      ...globalThis.navigator,
      clipboard: { readText },
    });

    document.body.innerHTML = `
      <main>
        <div data-test-render-count="2" class="group">
          <div data-testid="file-thumbnail">
            <button aria-label="Pasted Text, pasted, 191 lines">
              <p># Identity short preview...</p>
            </button>
          </div>
          <div data-testid="user-message">
            <div class="!font-user-message">translate this vapi prompt to german</div>
          </div>
        </div>
        <div class="font-claude-response">
          <div class="standard-markdown"><p>Done.</p></div>
        </div>
        <div class="flex h-full flex-col pb-1 pl-5 pt-3">
          <div class="sticky flex items-center gap-1 pr-5">
            <h2 class="font-ui">Pasted content</h2>
            <button aria-label="Copy pasted content">Copy</button>
          </div>
          <p>19.30 KB • 191 lines • Formatting may be inconsistent from source</p>
          <div class="font-mono whitespace-pre-wrap">${FULL_PASTE}</div>
        </div>
      </main>
    `;

    const promise = claudeAdapter.extract(document);
    await vi.runAllTimersAsync();
    const conversation = await promise;

    const paste = conversation.messages[0].attachments?.find((a) => a.kind === 'paste');
    expect(paste?.content).toContain('Thomas Meyer');
    expect(paste?.content.length).toBeGreaterThan(200);
  });

  it('findPasteContentPanel finds live Claude div panel (no dialog/aside)', () => {
    document.body.innerHTML = `
      <main>
        <div class="flex h-full flex-col pb-1 pl-5 pt-3">
          <div class="sticky flex items-center gap-1 pr-5">
            <button aria-label="Back">Back</button>
            <h2 class="font-ui flex-1 truncate text-lg font-medium">Pasted content</h2>
            <button aria-label="Copy pasted content">Copy</button>
          </div>
          <p>19.30 KB • 191 lines • Formatting may be inconsistent from source</p>
          <div class="font-mono whitespace-pre-wrap">${FULL_PASTE}</div>
        </div>
      </main>
    `;

    const panel = findPasteContentPanel(document);
    expect(panel).not.toBeNull();
    expect(panel?.className).toContain('flex h-full flex-col');
    expect(readPastePanelDom(panel!)).toContain('Thomas Meyer');
    expect(readPastePanelDom(panel!).length).toBeGreaterThan(400);
  });

  it('findPasteContentPanel finds dialog with Pasted content title', () => {
    document.body.innerHTML = `
      <main>
        <aside class="artifact-panel split-view">
          <button aria-label="Copy document">Copy</button>
          <div class="standard-markdown"><p>Artifact body</p></div>
        </aside>
        <div role="dialog" data-testid="paste-content-panel" aria-hidden="false">
          <h2>Pasted content</h2>
          <p>19.30 KB • 191 lines • Formatting may be inconsistent from source</p>
          <button aria-label="Copy pasted content">Copy</button>
          <div class="font-mono">${FULL_PASTE}</div>
        </div>
      </main>
    `;

    const panel = findPasteContentPanel(document);
    expect(panel).not.toBeNull();
    expect(panel?.getAttribute('data-testid')).toBe('paste-content-panel');
    expect(readPastePanelDom(panel!)).toContain('Thomas Meyer');
  });

  it('extractPastePreviewFromNode reads text inside thumbnail button', () => {
    document.body.innerHTML = `
      <div data-testid="file-thumbnail">
        <button aria-label="Pasted Text, pasted, 191 lines">
          <p class="line-clamp-[6]"># Identity &amp; Personality preview line</p>
          <p class="uppercase">pasted</p>
        </button>
      </div>
    `;

    const node = document.querySelector('[data-testid="file-thumbnail"]')!;
    const preview = extractPastePreviewFromNode(node);
    expect(preview).toContain('# Identity');
    expect(preview).not.toContain('PASTED');
  });

  it('includes truncated paste preview when hydration cache is empty', async () => {
    document.body.innerHTML = `
      <main>
        <div data-test-render-count="2" class="group">
          <div data-testid="file-thumbnail">
            <button aria-label="Pasted Text, pasted, 191 lines">
              <p class="line-clamp-[6]"># Identity &amp; Personality
You are a realistic roleplay simulator built for sales training at Hilti.</p>
              <p class="uppercase">pasted</p>
            </button>
          </div>
          <div data-testid="user-message">
            <div class="!font-user-message">translate this vapi prompt to german</div>
          </div>
        </div>
        <div class="font-claude-response">
          <div class="standard-markdown"><p>Done.</p></div>
        </div>
      </main>
    `;

    const promise = claudeAdapter.extract(document);
    await vi.runAllTimersAsync();
    const conversation = await promise;

    const paste = conversation.messages[0].attachments?.find((a) => a.kind === 'paste');
    expect(paste?.content).toContain('# Identity');
    expect(paste?.content).toContain('roleplay simulator');
  });

  it('keeps assistant role and commentary when grid uses row-start-1 layout', async () => {
    document.body.innerHTML = `
      <main>
        <div data-testid="user-message">
          <div class="!font-user-message">translate this vapi prompt to german</div>
        </div>
        <div class="font-claude-response">
          <div class="row-start-1 thinking-block">Extended thinking…</div>
          <div class="font-claude-response-body">
            <div class="row-start-1 standard-markdown">
              <p>A few translation choices worth flagging for German VAPI tone.</p>
            </div>
            <div class="row-start-2 artifact-block-cell" data-testid="artifact-card">
              Hilti vapi prompt deutsch Document · MD
            </div>
          </div>
        </div>
      </main>
    `;

    const promise = claudeAdapter.extract(document);
    await vi.runAllTimersAsync();
    const conversation = await promise;

    expect(conversation.messages[1].role).toBe('assistant');
    expect(conversation.messages[1].isThinking).toBeFalsy();
    expect(conversation.messages[1].content).toContain('translation choices');
  });

  it('strips sr-only orchestration status from assistant commentary', () => {
    document.body.innerHTML = `
      <div class="font-claude-response">
        <button class="group/status">
          <span class="truncate font-base">Orchestrated comprehensive German translation preserving nuance</span>
        </button>
        <span class="sr-only" role="status">Orchestrated comprehensive German translation preserving nuance</span>
        <div class="standard-markdown"><p>Visible commentary bullets.</p></div>
      </div>
    `;
    const el = document.querySelector('.font-claude-response')!;
    const { text } = extractClaudeAssistantCommentary(el);
    expect(text).toContain('Visible commentary bullets');
    expect(text).not.toContain('Orchestrated comprehensive');
  });

  it('rejects artifact content that duplicates the user prompt', async () => {
    const userPrompt =
      'translate this vapi prompt to german. i wanna make a german version of the same agent.';

    document.body.innerHTML = `
      <main>
        <div data-testid="user-message">
          <div class="!font-user-message">${userPrompt}</div>
        </div>
        <div class="font-claude-response">
          <div class="standard-markdown"><p>Translation notes below.</p></div>
          <div class="group/artifact-block">
            <button class="absolute inset-0" aria-label="View Hilti vapi prompt deutsch"></button>
            <div class="artifact-block-cell" data-testid="artifact-card">Hilti vapi prompt deutsch Document · MD</div>
          </div>
        </div>
        <aside class="artifact-panel split-view">
          <button aria-label="Copy document">Copy</button>
        </aside>
      </main>
    `;

    vi.stubGlobal('navigator', {
      ...globalThis.navigator,
      clipboard: {
        readText: vi.fn().mockResolvedValue(userPrompt),
      },
    });

    const promise = claudeAdapter.extract(document);
    await vi.runAllTimersAsync();
    const conversation = await promise;

    expect(conversation.messages[1].role).toBe('assistant');
    expect(conversation.messages[1].content).toContain('Translation notes');
    expect(conversation.messages[1].content).not.toContain('## Hilti vapi prompt deutsch');
    expect(conversation.messages[1].attachments).toBeUndefined();
  });

  it('extracts full conversation from production-shaped fixture', async () => {
    vi.stubGlobal('navigator', {
      ...globalThis.navigator,
      clipboard: {
        readText: vi.fn().mockImplementation(async () => FULL_PASTE),
      },
    });

    const fixture = readFileSync(
      resolve(__dirname, '../fixtures/claude-vapi-german.html'),
      'utf-8',
    );
    document.body.innerHTML = fixture;

    const promise = claudeAdapter.extract(document);
    await vi.runAllTimersAsync();
    const conversation = await promise;

    expect(conversation.messages).toHaveLength(2);
    expect(conversation.messages[0].attachments?.[0]?.content).toContain('Identity & Personality');
    expect(conversation.messages[0].content).toContain('translate this vapi prompt');
    expect(conversation.messages[1].content).toContain('translation choices');
    expect(conversation.messages[1].content).not.toContain('Orchestrated comprehensive');
    expect(conversation.messages[1].attachments?.[0]?.kind).toBe('artifact');
    expect(conversation.messages[1].attachments?.[0]?.content).toContain('Identität');
    expect(conversation.messages[1].content).toContain('Identität');
    expect(conversation.messages[1].content).toContain('Thomas Meyer');
  });

  it('reads artifact body from live-style generic div panel without standard-markdown', async () => {
    document.body.innerHTML = `
      <main>
        <div data-test-render-count="1" class="group">
          <div data-testid="user-message">
            <div class="!font-user-message">translate this vapi prompt to german</div>
          </div>
        </div>
        <div data-test-render-count="2" class="group">
          <div class="font-claude-response">
            <div class="standard-markdown"><p>Translation notes.</p></div>
            <div class="group/artifact-block">
              <button class="absolute inset-0" aria-label="View Hilti vapi prompt deutsch"></button>
              <div class="artifact-block-cell" data-testid="artifact-card">
                <div class="line-clamp-1">Hilti vapi prompt deutsch</div>
                <button aria-label="Download Hilti vapi prompt deutsch">Download</button>
              </div>
            </div>
          </div>
        </div>
      </main>
    `;

    document.querySelector('button[aria-label^="View "]')!.addEventListener('click', () => {
      const panel = document.createElement('div');
      panel.className = 'flex h-full flex-col pb-1 pl-5 pt-3';
      panel.innerHTML = `
        <h2 class="font-ui">Hilti vapi prompt deutsch</h2>
        <button aria-label="Copy document">Copy</button>
        <div class="font-mono whitespace-pre-wrap">${FULL_ARTIFACT}</div>
      `;
      document.body.appendChild(panel);
    });

    const promise = claudeAdapter.extract(document);
    await vi.runAllTimersAsync();
    const conversation = await promise;

    expect(conversation.messages[1].attachments?.[0]?.kind).toBe('artifact');
    expect(conversation.messages[1].attachments?.[0]?.content).toContain('Identität');
    expect(conversation.messages[1].content).toContain('Thomas Meyer');
  });

  it('hydrates artifact when panel mounts only after View click', async () => {
    const readText = vi.fn().mockResolvedValue(FULL_ARTIFACT);
    vi.stubGlobal('navigator', {
      ...globalThis.navigator,
      clipboard: { readText },
    });

    document.body.innerHTML = `
      <main>
        <div data-test-render-count="1" class="group">
          <div data-testid="user-message">
            <div class="!font-user-message">translate this vapi prompt to german</div>
          </div>
        </div>
        <div data-test-render-count="2" class="group">
          <div class="font-claude-response">
            <div class="standard-markdown"><p>Translation notes.</p></div>
            <div class="group/artifact-block">
              <button class="absolute inset-0" aria-label="View Hilti vapi prompt deutsch"></button>
              <div class="artifact-block-cell" data-testid="artifact-card">
                <div class="line-clamp-1">Hilti vapi prompt deutsch</div>
                <button aria-label="Download Hilti vapi prompt deutsch">Download</button>
              </div>
            </div>
          </div>
        </div>
      </main>
    `;

    document.querySelector('button[aria-label^="View "]')!.addEventListener('click', () => {
      const panel = document.createElement('aside');
      panel.className = 'artifact-panel split-view';
      panel.innerHTML = `
        <button aria-label="Copy document">Copy</button>
        <div class="standard-markdown">${FULL_ARTIFACT}</div>
      `;
      document.body.appendChild(panel);
    });

    const promise = claudeAdapter.extract(document);
    await vi.runAllTimersAsync();
    const conversation = await promise;

    expect(conversation.messages).toHaveLength(2);
    expect(conversation.messages[1].attachments?.[0]?.content).toContain('Identität');
    expect(conversation.messages[1].content).toContain('Thomas Meyer');
  });

  it('exports multi-turn thread with artifact on first assistant only', async () => {
    vi.stubGlobal('navigator', {
      ...globalThis.navigator,
      clipboard: {
        readText: vi.fn().mockImplementation(async () => FULL_PASTE),
      },
    });

    document.body.innerHTML = `
      <main>
        <div data-test-render-count="1" class="group">
          <div data-testid="file-thumbnail">
            <button aria-label="Pasted Text, pasted, 191 lines">
              <p># Identity preview</p>
            </button>
          </div>
          <div data-testid="user-message">
            <div class="!font-user-message">translate this vapi prompt to german</div>
          </div>
        </div>
        <div data-test-render-count="2" class="group">
          <div class="font-claude-response">
            <div class="standard-markdown"><p>Translation notes.</p></div>
            <div class="group/artifact-block">
              <button class="absolute inset-0" aria-label="View Hilti vapi prompt deutsch"></button>
              <div class="artifact-block-cell" data-testid="artifact-card">
                <div class="line-clamp-1">Hilti vapi prompt deutsch</div>
              </div>
            </div>
          </div>
        </div>
        <div data-test-render-count="3" class="group">
          <div data-testid="user-message">
            <div class="!font-user-message">where does pasted text live in the dom</div>
          </div>
        </div>
        <div data-test-render-count="4" class="group">
          <div class="font-claude-response">
            <div class="standard-markdown"><p>Inspect DevTools for paste selectors.</p></div>
          </div>
        </div>
        <div class="flex h-full flex-col pb-1 pl-5 pt-3">
          <h2 class="font-ui">Pasted content</h2>
          <button aria-label="Copy pasted content">Copy</button>
          <div class="font-mono whitespace-pre-wrap">${FULL_PASTE}</div>
        </div>
      </main>
    `;

    document.querySelector('button[aria-label^="View "]')!.addEventListener('click', () => {
      const panel = document.createElement('aside');
      panel.className = 'artifact-panel split-view';
      panel.innerHTML = `
        <h2>Hilti vapi prompt deutsch</h2>
        <button aria-label="Copy document">Copy</button>
        <div class="standard-markdown">${FULL_ARTIFACT}</div>
      `;
      document.body.appendChild(panel);
    });

    const promise = claudeAdapter.extract(document);
    await vi.runAllTimersAsync();
    const conversation = await promise;

    expect(conversation.messages).toHaveLength(4);
    expect(conversation.messages[0].attachments?.[0]?.kind).toBe('paste');
    expect(conversation.messages[1].attachments?.[0]?.kind).toBe('artifact');
    expect(conversation.messages[1].attachments?.[0]?.content).toContain('Identität');
    expect(conversation.messages[2].attachments).toBeUndefined();
    expect(conversation.messages[3].content).toContain('DevTools');
  });

  it('hydrated cache keys normalize artifact and paste labels', () => {
    const cache = new HydratedContentCache();
    cache.set(cacheKeyForPaste('Pasted Text, pasted, 191 lines'), FULL_PASTE);
    cache.set(cacheKeyForArtifact('Hilti vapi prompt deutsch'), FULL_ARTIFACT);
    expect(cache.getFuzzy('pasted text')).toContain('Identity & Personality');
    expect(cache.get('hilti vapi prompt deutsch')).toContain('Identität');
  });

  it('does not attach earlier paste thumbnail to a later user turn', () => {
    document.body.innerHTML = `
      <main>
        <div data-test-render-count="1" class="group">
          <div data-testid="file-thumbnail">
            <button aria-label="Pasted Text, pasted, 191 lines">
              <p># Identity preview</p>
            </button>
          </div>
          <div data-testid="user-message">
            <div class="!font-user-message">translate this vapi prompt to german</div>
          </div>
        </div>
        <div data-test-render-count="2" class="group">
          <div data-testid="user-message">
            <div class="!font-user-message">where does pasted text live in the dom</div>
          </div>
        </div>
      </main>
    `;

    const secondUser = document.querySelectorAll('[data-testid="user-message"]')[1];
    const turnRoot = findClaudeUserTurnRoot(secondUser);
    const pasteNodes = collectPasteNodesInTurn(turnRoot, secondUser);
    expect(pasteNodes.length).toBe(0);
  });

  it('ignores artifact side panel when collecting assistant turns', () => {
    document.body.innerHTML = `
      <main>
        <div data-test-render-count="1" class="group">
          <div data-testid="user-message">
            <div class="!font-user-message">translate</div>
          </div>
        </div>
        <div data-test-render-count="2" class="group">
          <div class="font-claude-response">
            <div class="standard-markdown"><p>Translation notes.</p></div>
          </div>
        </div>
        <aside class="artifact-panel split-view">
          <div class="font-claude-response">
            <div class="standard-markdown"><h1>Identität</h1><p>${FULL_ARTIFACT}</p></div>
          </div>
        </aside>
      </main>
    `;

    const streamResponses = [...document.querySelectorAll('.font-claude-response')].filter(
      isClaudeChatStreamTurn,
    );
    expect(streamResponses.length).toBe(1);
    expect(streamResponses[0].textContent).toContain('Translation notes');
  });
});
