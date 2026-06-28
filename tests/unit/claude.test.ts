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
});
