import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { perplexityAdapter } from '../../src/adapters/perplexity';

describe('perplexityAdapter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <main>
        <div class="mb-md group/query">
          <div class="text-xs">PASTED</div>
          <div class="bg-offset rounded-2xl">
            <span class="select-text">What is OpenClaw?</span>
          </div>
        </div>
        <div id="markdown-content-0">
          <div class="prose dark:prose-invert">
            <p>OpenClaw is an automation framework.</p>
            <p>This response is AI-generated, for reference only.</p>
          </div>
        </div>
        <div class="mb-md group/query">
          <div class="bg-offset rounded-2xl">
            <div class="prose">
              <p>change the project idea then. the only requirement is openclaw.</p>
            </div>
          </div>
        </div>
        <div id="markdown-content-1">
          <div class="prose dark:prose-invert">
            <p>Here is a revised project idea.</p>
          </div>
        </div>
      </main>
    `;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('labels user queries as user even when they contain inner prose', async () => {
    const promise = perplexityAdapter.extract(document);
    await vi.runAllTimersAsync();
    const conversation = await promise;

    expect(conversation.messages).toHaveLength(4);
    expect(conversation.messages.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
    ]);
    expect(conversation.messages[2].content).toContain('change the project idea');
    expect(conversation.messages[1].content).not.toContain('AI-generated');
  });
});
