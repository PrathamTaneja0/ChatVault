import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { geminiAdapter } from '../../src/adapters/gemini';

describe('geminiAdapter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('offline test'))));
    document.body.innerHTML = `
      <main>
        <div id="chat-history">
          <user-query><span class="query-text">Show me a chart of Q2 sales</span></user-query>
          <model-response>
            <model-thoughts><div>Considering which chart type fits best…</div></model-thoughts>
            <message-content>
              <div class="markdown">
                <p>Here is the Q2 sales chart you asked for.</p>
                <img src="https://lh3.googleusercontent.com/chart-q2" width="480" height="320" alt="Q2 chart">
              </div>
            </message-content>
            <div class="suggestion-chips"><button>Yes</button></div>
          </model-response>
          <user-query><span class="query-text">Thanks, looks great</span></user-query>
        </div>
      </main>
    `;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('matches gemini URLs only', () => {
    expect(geminiAdapter.matches('https://gemini.google.com/app/abc')).toBe(true);
    expect(geminiAdapter.matches('https://chatgpt.com/c/x')).toBe(false);
  });

  it('extracts user and assistant turns in order', async () => {
    const promise = geminiAdapter.extract(document);
    await vi.runAllTimersAsync();
    const conversation = await promise;

    expect(conversation.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(conversation.messages[0].content).toContain('Q2 sales');
    expect(conversation.messages[1].content).toContain('sales chart you asked for');
    expect(conversation.messages[2].content).toContain('Thanks');
    expect(conversation.metadata.platform).toBe('gemini');
    expect(conversation.metadata.source).toBe('dom');
  });

  it('strips thought panels from assistant content', async () => {
    const promise = geminiAdapter.extract(document);
    await vi.runAllTimersAsync();
    const conversation = await promise;

    expect(conversation.messages[1].content).not.toContain('Considering which chart type');
  });

  it('collects content images as attachments with source urls', async () => {
    const promise = geminiAdapter.extract(document);
    await vi.runAllTimersAsync();
    const conversation = await promise;

    const images = conversation.messages[1].attachments?.filter((a) => a.kind === 'image');
    expect(images).toHaveLength(1);
    expect(images![0].sourceUrl).toBe('https://lh3.googleusercontent.com/chart-q2');
    expect(images![0].name).toBe('Q2 chart');
  });
});
