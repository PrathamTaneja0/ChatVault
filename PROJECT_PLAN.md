# ChatVault Export v2 — Production Readiness Plan

> Branch: `feat/v2-api-first-restructure` · Started: 2026-07-08

## 1. Problem statement

The extension exports the current AI chat to PDF/JSON in one click, but v1 is built on
fragile mechanisms that fail intermittently:

| Symptom | Root cause |
|---------|-----------|
| Pasted text on Claude sometimes missing | Recovery relies on UI automation: clicking paste thumbnails, DOM-climbing to find side panels, reading the clipboard, hooking `window.fetch` in the page world. Any timing hiccup or Claude UI change breaks it. |
| Generated (assistant) text sometimes missing on Claude/Gemini | Detection relies on unstable class selectors (`.font-claude-response`, Gemini content classes). Long chats also virtualize: `scrollSweep()` only scrolls *down* from the current position, but chats open at the bottom, so older messages never mount into the DOM. It also often targets `main`, which is not the actual scrollable element. |
| Document/artifact text missing | Same UI-automation pipeline (open panel → read DOM → click Copy → read clipboard → intercept downloads). Four fallbacks deep and still racy. |
| No images in export | Schema, renderer, and PDF pipeline have no image concept. |
| Repeated identical messages disappear | `dedupeMessages()` dedupes globally by role+content, so a user sending "yes" twice loses a turn. |
| Errors are `alert()` popups | No error UI; poor product feel. |

## 2. Architecture change: API-first, DOM-fallback

The platforms' own web apps fetch conversation JSON from internal endpoints using the
logged-in session cookie. A content script on the same origin can issue the same
read-only GET requests. This yields the *complete* conversation — full pasted content,
artifacts, thinking blocks, image file references, titles, timestamps — with no
scrolling, no clicking, no clipboard, no fetch hooks.

```
extract()
  ├─ 1. API source (claude-api.ts / chatgpt-api.ts)   ← primary, exact
  │      same-origin GET with credentials; defensive JSON mapping
  └─ 2. DOM source (existing adapter pipeline)         ← fallback
         hardened scroll sweep + selector chains + hydration (Claude)
```

- **Claude** (`src/sources/claude-api.ts`): org id from `lastActiveOrg` cookie or
  `/api/organizations`; conversation id from URL; GET
  `/api/organizations/{org}/chat_conversations/{id}?tree=True&rendering_mode=messages&render_all_tools=true`.
  Maps `chat_messages[]` → messages (typed `content[]` blocks when present, `text`
  otherwise), `attachments[].extracted_content` → paste attachments, artifact
  `tool_use` blocks → artifact attachments, `files[]`/`files_v2[]` → image attachments.
- **ChatGPT** (`src/sources/chatgpt-api.ts`): access token via `/api/auth/session`;
  GET `/backend-api/conversation/{id}`; walk `mapping` from `current_node` to root to
  reconstruct the active branch; map text / multimodal / thoughts parts.
- **Gemini**: no stable JSON endpoint → hardened DOM extraction only.
- The DOM pipeline itself is fixed for all platforms: pick the first *actually
  scrollable* container, sweep to the **top first** (virtualized lists load older
  content upward), then sweep down.

## 3. Images in the export

- Schema: `Attachment` gains `kind: 'image'` + `dataUrl`.
- `src/core/images.ts`: fetch each image URL from the content script (same-origin
  cookies apply), fall back to canvas re-encode of the already-rendered `<img>`;
  normalize to PNG/JPEG data URLs (pdfmake only accepts those), cap dimensions
  (1400px) and count (40) to keep PDFs sane.
- DOM adapters collect content images (filtering avatars/icons by size); the Claude
  API source collects image file references.
- Renderer embeds `<img src="data:...">` in preview HTML; `html-to-pdfmake` turns
  them into pdfmake image nodes.
- Host permissions extended for the two big image CDNs
  (`*.googleusercontent.com`, `*.oaiusercontent.com`).

## 4. Product/code quality

- In-overlay error panel (message + retry) replacing `alert()`.
- Extraction source surfaced in metadata (`api` vs `dom`) for trust/debuggability.
- Dedupe only *adjacent* duplicates (fixes lost repeated turns; still kills
  double-matched selectors).
- `generateFilename()` `{count}` uses the filtered message count.
- Drop unused `scripting` + `downloads` permissions (smaller store-review surface).
- Version → 2.0.0; docs synced.

## 5. Testing

- Unit fixtures for both API payload shapes (incl. degenerate/legacy variants) →
  mapper tests.
- Image utils tests (mime sniffing, data-URL passthrough, cap logic).
- Gemini adapter fixture test; scrollable-container detection tests; dedupe and
  filename regression tests.
- Full suite + production build must stay green: `npm test`, `npm run build`.
- Manual smoke checklist (see §7) for live sites, since login-gated DOM can't run in CI.

## 6. Phases

1. ✅ Plan + branch
2. Core foundation: image schema, scroll fix, source plumbing
3. Claude API source + adapter wiring
4. ChatGPT API source + adapter wiring
5. Image pipeline + render/PDF embedding
6. Gemini/DOM hardening
7. Overlay error UI
8. Bug fixes (dedupe, filename, permissions)
9. Tests
10. Build, docs, version bump

## 7. Manual smoke checklist (post-merge, live sites)

- [ ] Claude: chat with long paste → paste appears in full in PDF/JSON
- [ ] Claude: chat with artifact/document → artifact body exported
- [ ] Claude: logged-in long chat (100+ turns) → all turns present, API badge shown
- [ ] ChatGPT: normal chat → full history via API
- [ ] Gemini: long chat → older turns load (conversation scrolls, not the sidebar)
- [ ] Code-heavy chat → dark syntax-colored code blocks in preview and PDF
- [ ] Theme toggle → dark PDF pages with light text; setting persists
- [ ] Toolbar icon → popup opens; Export-this-chat works; GitHub link opens
- [ ] Each remaining platform: FAB export still works (DOM path)
- [ ] Kill-switch check: block `/api/` in DevTools → DOM fallback still exports

## 8. v2.1 revisions (user feedback round, 2026-07-12)

- Scroll sweep targets only containers that hold message elements (fixes
  Gemini sweeping the recent-chats sidebar).
- Images/files removed from exports by request — text, pastes, thinking,
  and artifacts only; host permissions trimmed back to the AI sites.
- Themed documents: light/dark toggle (persisted), redesigned header and
  role pills, One Dark code blocks in both themes and in the PDF.
- Dark overlay scrollbars; redesigned icon set (SVG → sharp); toolbar
  popup with usage guide + GitHub link replaces direct-trigger click.
