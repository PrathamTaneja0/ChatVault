import { describe, it, expect } from 'vitest';
import {
  getClaudeConversationId,
  mapClaudeApiConversation,
  type ClaudeApiConversation,
} from '../../src/sources/claude-api';

const FULL_PASTE = `# Identity & Personality

You are a realistic roleplay simulator built for sales training at Hilti.
You play exclusively the role of Thomas Meyer, an existing Hilti customer.`;

const PAGE_URL = 'https://claude.ai/chat/0198a2b3-1111-2222-3333-444455556666';

const MODERN_PAYLOAD: ClaudeApiConversation = {
  uuid: 'conv-1',
  name: 'Hilti price objection roleplay',
  model: 'claude-sonnet-4-5',
  chat_messages: [
    {
      uuid: 'msg-1',
      sender: 'human',
      index: 0,
      created_at: '2026-07-01T10:00:00Z',
      content: [{ type: 'text', text: 'Translate this prompt to German.' }],
      attachments: [
        { file_name: 'paste.txt', file_type: 'txt', extracted_content: FULL_PASTE },
      ],
    },
    {
      uuid: 'msg-2',
      sender: 'assistant',
      index: 1,
      created_at: '2026-07-01T10:00:30Z',
      content: [
        { type: 'thinking', thinking: 'The user wants a German translation of the roleplay prompt.' },
        { type: 'text', text: 'Here is the German version of your prompt.' },
        {
          type: 'tool_use',
          name: 'artifacts',
          input: {
            command: 'create',
            id: 'a1',
            title: 'Vapi Prompt DE',
            type: 'text/markdown',
            content: '# Identität\n\nDu bist Thomas Meyer, ein Hilti-Kunde.',
          },
        },
        {
          type: 'tool_use',
          name: 'artifacts',
          input: {
            command: 'update',
            id: 'a1',
            old_str: 'Thomas Meyer',
            new_str: 'Thomas Meyer aus München',
          },
        },
      ],
    },
  ],
};

describe('getClaudeConversationId', () => {
  it('extracts the conversation uuid from a chat path', () => {
    expect(getClaudeConversationId('/chat/0198a2b3-1111-2222-3333-444455556666')).toBe(
      '0198a2b3-1111-2222-3333-444455556666',
    );
  });

  it('returns undefined for non-chat paths', () => {
    expect(getClaudeConversationId('/new')).toBeUndefined();
    expect(getClaudeConversationId('/settings/profile')).toBeUndefined();
  });
});

describe('mapClaudeApiConversation', () => {
  it('maps user and assistant turns with a separate reasoning message', () => {
    const conversation = mapClaudeApiConversation(MODERN_PAYLOAD, PAGE_URL)!;
    expect(conversation).not.toBeNull();
    expect(conversation.messages.map((m) => m.role)).toEqual(['user', 'reasoning', 'assistant']);
    expect(conversation.messages[0].content).toBe('Translate this prompt to German.');
    expect(conversation.messages[1].content).toContain('German translation');
    expect(conversation.messages[1].isThinking).toBe(true);
    expect(conversation.messages[2].content).toBe('Here is the German version of your prompt.');
  });

  it('maps pasted content from attachments.extracted_content', () => {
    const conversation = mapClaudeApiConversation(MODERN_PAYLOAD, PAGE_URL)!;
    const pastes = conversation.messages[0].attachments?.filter((a) => a.kind === 'paste');
    expect(pastes).toHaveLength(1);
    expect(pastes![0].content).toBe(FULL_PASTE);
    expect(pastes![0].name).toBe('paste.txt');
  });

  it('accumulates artifact create + update commands', () => {
    const conversation = mapClaudeApiConversation(MODERN_PAYLOAD, PAGE_URL)!;
    const artifacts = conversation.messages[2].attachments?.filter((a) => a.kind === 'artifact');
    expect(artifacts).toHaveLength(1);
    expect(artifacts![0].name).toBe('Vapi Prompt DE');
    expect(artifacts![0].content).toContain('Thomas Meyer aus München');
    expect(artifacts![0].mimeType).toBe('text/markdown');
  });

  it('sets api source metadata and title', () => {
    const conversation = mapClaudeApiConversation(MODERN_PAYLOAD, PAGE_URL)!;
    expect(conversation.metadata.source).toBe('api');
    expect(conversation.metadata.platform).toBe('claude');
    expect(conversation.metadata.title).toBe('Hilti price objection roleplay');
    expect(conversation.metadata.messageCount).toBe(3);
  });

  it('supports legacy payloads that only have a text field', () => {
    const legacy: ClaudeApiConversation = {
      name: 'Legacy chat',
      chat_messages: [
        { uuid: 'l1', sender: 'human', text: 'Hello there' },
        { uuid: 'l2', sender: 'assistant', text: 'Hi! How can I help?' },
      ],
    };
    const conversation = mapClaudeApiConversation(legacy, PAGE_URL)!;
    expect(conversation.messages).toHaveLength(2);
    expect(conversation.messages[0].content).toBe('Hello there');
    expect(conversation.messages[1].content).toBe('Hi! How can I help?');
  });

  it('orders messages by index when present', () => {
    const shuffled: ClaudeApiConversation = {
      chat_messages: [
        { uuid: 'b', sender: 'assistant', index: 1, text: 'Answer' },
        { uuid: 'a', sender: 'human', index: 0, text: 'Question' },
      ],
    };
    const conversation = mapClaudeApiConversation(shuffled, PAGE_URL)!;
    expect(conversation.messages.map((m) => m.content)).toEqual(['Question', 'Answer']);
  });

  it('returns null for empty or malformed payloads', () => {
    expect(mapClaudeApiConversation({}, PAGE_URL)).toBeNull();
    expect(mapClaudeApiConversation({ chat_messages: [] }, PAGE_URL)).toBeNull();
    expect(
      mapClaudeApiConversation({ chat_messages: [{ sender: 'human' }] }, PAGE_URL),
    ).toBeNull();
  });
});
