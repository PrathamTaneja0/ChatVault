# ChatVault Export – Platform Selectors

This document lists the CSS selector fallback chains used by each platform adapter. Selectors are tried in order; the first match wins.

## Selector Strategy

Each adapter defines:

- **container** – scrollable chat area
- **message** – individual message turn elements
- **roleUser / roleAssistant** – role detection overrides
- **content** – inner content node for markdown extraction
- **title** – conversation title
- **model** – active model name
- **streaming** – element indicating active generation (ChatGPT only)
- **thinking** – reasoning/thinking chain blocks

## P0 Platforms

### ChatGPT (`chatgpt.com`, `chat.openai.com`)

| Field | Selectors |
|---|---|
| container | `main`, `[role="main"]`, `.flex.flex-col.text-sm` |
| message | `[data-message-author-role]`, `article[data-testid^="conversation-turn"]`, `div.group.w-full` |
| content | `.markdown`, `.prose`, `[data-message-id] .markdown` |
| streaming | `[data-testid="stop-button"]`, `button[aria-label="Stop streaming"]` |

### Claude (`claude.ai`)

| Field | Selectors |
|---|---|
| message | `[data-testid="user-message"]`, `[data-testid="assistant-message"]` |
| thinking | `.thinking-block`, `[data-is-thinking]` |

### DeepSeek (`chat.deepseek.com`)

Uses **virtual scroll sweep** – iterates message elements with `scrollIntoView` to force lazy-loaded DOM nodes to render.

| Field | Selectors |
|---|---|
| message | `[data-message-id]`, `.ds-message`, `.message-item` |

### Gemini (`gemini.google.com`)

| Field | Selectors |
|---|---|
| message | `user-query`, `model-response`, `message-content` |

### Grok (`grok.com`, `x.com`)

| Field | Selectors |
|---|---|
| message | `[data-testid="message"]`, `.message-bubble` |

### Perplexity (`perplexity.ai`)

| Field | Selectors |
|---|---|
| message | `[data-testid="user-message"]`, `[data-testid="assistant-message"]` |

## P1 Platforms

### Copilot (`copilot.microsoft.com`)

| Field | Selectors |
|---|---|
| message | `[data-content="user-message"]`, `[data-content="ai-message"]`, `cib-message-group` |

### Poe (`poe.com`)

| Field | Selectors |
|---|---|
| message | `.Message_botMessageBubble`, `.Message_humanMessageBubble` |

### Kimi (`kimi.moonshot.cn`, `kimi.com`)

| Field | Selectors |
|---|---|
| message | `[data-testid="message"]`, `.message-item` |

### Qwen (`chat.qwen.ai`)

| Field | Selectors |
|---|---|
| message | `.message-item`, `[data-message-id]` |

### NotebookLM (`notebooklm.google.com`)

| Field | Selectors |
|---|---|
| message | `.chat-message`, `[data-message-type]` |

### Google AI Studio (`aistudio.google.com`)

| Field | Selectors |
|---|---|
| message | `.chat-turn`, `[data-turn]` |

## Updating Selectors

When a platform changes its DOM structure:

1. Open the platform in Chrome DevTools
2. Identify new message container/turn selectors
3. Add them as **earlier** entries in the fallback chain (in the adapter file under `src/adapters/`)
4. Run selector diagnostics from the extension popup to verify matches

## Diagnostics

The popup shows live selector match counts for the current page. A ✓ with count > 0 means the selector matched elements.
