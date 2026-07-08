# ChatVault Export – Privacy Policy

**Last updated:** July 8, 2026

## Overview

ChatVault Export is a browser extension that extracts chat conversations from AI platforms and exports them as PDF files. Your privacy is important to us.

## Data Collection

**We do not collect, transmit, or store any of your data on external servers.**

All processing happens entirely within your browser:

- Chat content is read either from the platform's own conversation API (a
  same-origin, read-only request made with your existing login session — the
  same request the platform's web app makes) or from the DOM of the page you
  are viewing
- Images embedded in exports are fetched with your session and converted
  locally; they are never sent anywhere
- PDF generation runs locally using pdfmake
- Export preferences are stored in `chrome.storage.local` on your device only

## Permissions Explained

| Permission | Why it's needed |
|---|---|
| `activeTab` | Access the current AI chat page when you click Export |
| `storage` | Save your export preferences (filename template, toggles) |
| `clipboardRead` | Fallback reading of Claude panel content when the API is unavailable |
| Host permissions | Run on supported AI chat platform URLs, plus the image CDNs those platforms use (`googleusercontent.com`, `oaiusercontent.com`) so images can be embedded in your export |

## Third-Party Services

When rendering PDF previews, the extension may load:

- **Google Fonts** (Inter, JetBrains Mono) for typography
- **highlight.js CDN** for syntax highlighting styles

These are loaded only during export preview and do not transmit your chat content.

## Data Retention

- No chat data is retained after export completes
- Preferences persist in local browser storage until you uninstall the extension

## Contact

For privacy questions, open an issue on the GitHub repository.
