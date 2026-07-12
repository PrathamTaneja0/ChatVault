# 📤 ChatVault Export

Export your AI conversations to **beautiful PDFs** (or JSON) in one click. 🖱️

Grabs the *entire* chat — full pasted content, generated documents, thinking chains, and syntax-highlighted code — from **12 AI platforms**. Everything runs locally in your browser. 🔒

## ✨ Features

- ⚡ **One click** — floating button, `Ctrl+Shift+E`, or the toolbar popup
- 🎯 **API-accurate** — reads the same data Claude/ChatGPT load themselves, with DOM fallback everywhere else
- 📋 **Nothing missing** — pasted text, artifacts/documents, reasoning chains
- 🎨 **Notion-style code blocks** — dark panels with full syntax colors
- ✂️ **Pick your messages** — export all or just a selection
- 🕵️ **Private by design** — zero servers, zero tracking, zero external requests

## 🤖 Supported platforms

ChatGPT · Claude · Gemini · DeepSeek · Grok · Perplexity · Copilot · Poe · Kimi · Qwen · NotebookLM · AI Studio

## 🚀 Install

```bash
npm install
npm run build
```

Then: `chrome://extensions` → **Developer mode** → **Load unpacked** → select `.output/chrome-mv3/` ✅

## 💡 Use

1. Open a conversation on a supported platform
2. Click the floating **export** button (bottom-right) or press `Ctrl+Shift+E`
3. Preview → pick messages, toggle thinking chains
4. **Copy JSON** 📋 or **Download PDF** 📄

> 💚 **API** badge = exact capture from the platform's own backend · 🟡 **Page** badge = read from the page (used when no API exists, e.g. Gemini, or when logged out)

## 🛠️ Development

```bash
npm run dev        # hot-reload dev build
npm test           # 100+ unit tests
npm run typecheck  # strict TypeScript
npm run zip        # store-ready package
npm run icons      # regenerate icon set
```

Built with [WXT](https://wxt.dev) + TypeScript + Manifest V3.
Architecture, decisions & smoke checklist: [PROJECT_PLAN.md](PROJECT_PLAN.md) 📐

## 📄 License

MIT
