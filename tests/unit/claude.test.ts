import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { claudeAdapter } from '../../src/adapters/claude';

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

  it('includes assistant artifact document body from open panel', async () => {
    document.body.innerHTML = `
      <main>
        <div data-testid="user-message">
          <div class="!font-user-message">translate prompt</div>
        </div>
        <div class="font-claude-response">
          <div class="standard-markdown"><p>Here is the German version.</p></div>
          <div data-testid="artifact-card">Hilti vapi prompt deutsch Document · MD</div>
        </div>
        <aside class="artifact-panel">
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
  });
});
