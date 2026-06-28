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
| user turn | `[data-test-render-count]` groups containing `[data-testid="user-message"]`, fallback `[data-testid="user-message"]` |
| assistant turn | `.font-claude-response` (top-level, nested-filtered) |
| paste blocks | `[data-testid="file-thumbnail"]`, `.artifact-block-cell`, `[class*="paste-preview"]`, preceding siblings with `PASTED` label |
| paste panel (hydration) | Click `file-thumbnail` → **"Pasted content"** overlay. Live UI: `h2.font-ui` title inside generic `div` stack (not `dialog`/`aside`). Climb from title to first ancestor with Copy button + body ≥ 400 chars (`flex h-full flex-col` wrapper). Read `[class*="font-mono"]` / `pre` or panel Copy. **No network request** on paste click. Dismiss via Close/Back. |
| artifacts | `[class*="artifact-block"]`, `.group/artifact-block` — click `button[aria-label^="View "]` or `button.absolute.inset-0`. Live side panel: climb from `h1`/`h2` title to ancestor with Copy + body ≥ 100 chars (same generic div stack as paste; body may be `[class*="font-mono"]` not `.standard-markdown`). Fallback: `download-file` via page-world fetch hook + Performance API URL + direct `fetch(credentials: include)`. |
| thinking | `.thinking-block`, `[data-is-thinking="true"]` |

### DeepSeek (`chat.deepseek.com`)

Uses **virtual scroll sweep** – iterates message elements with `scrollIntoView` to force lazy-loaded DOM nodes to render.

| Field | Selectors |
|---|---|
| message | `[data-message-id]`, `.ds-message`, `.message-item` |

### Gemini (`gemini.google.com`)

| Field | Selectors |
|---|---|
| message | `user-query`, `model-response` (merged via `queryAllMerged` — both roles required) |
| roleUser | `user-query`, `[data-role="user"]` |
| roleAssistant | `model-response`, `[data-role="model"]` |
| content | `.markdown`, `.model-response-text`, `.query-text` |

Diagnostics report separate counts for user and assistant message selectors.

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
