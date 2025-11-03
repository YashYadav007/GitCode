# GitCode – LeetCode ➜ GitHub + In‑My‑Style Copilot

GitCode is a Manifest V3 Chrome extension that keeps your LeetCode grind in sync with GitHub and adds a repo-aware “In-My-Style” suggester powered by your own solved problems.

- 🚀 Auto-push accepted LeetCode submissions directly into your repository.
- 🧠 Build a local BM25 index of past solutions and feed it to an OpenAI-powered generator.
- 🎯 Inject context-aware hints/skeletons that mimic your naming, helpers, and comment voice.
- 🛠️ Works with any language LeetCode supports; supports private repos via GitHub token.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Install & Load Extension](#install--load-extension)
3. [First-Time Configuration](#first-time-configuration)
4. [Key Features](#key-features)
5. [Using In-My-Style Suggestions](#using-in-my-style-suggestions)
6. [RAG Pipeline Details](#rag-pipeline-details)
7. [Troubleshooting](#troubleshooting)
8. [FAQ](#faq)
9. [Development Notes](#development-notes)
10. [Contributing](#contributing)
11. [License](#license)

---

## Prerequisites

- **Chrome 114+** (or any Chromium-based browser supporting Manifest V3).
- **GitHub Personal Access Token** with at least `repo` (or `public_repo`) scope.
- Optional: **OpenAI API key** (for GPT-4.1 turbo/4.0 tools or 4.1 preview access).
- A repository that will hold your LeetCode solutions (GitCode organizes by language).

---

## Install & Load Extension

1. Clone this repo locally.
2. Open Chrome → `chrome://extensions`.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the cloned folder.
5. Pin the extension for easy access.

> Updates: Reload the extension whenever you pull new changes (`chrome://extensions → Reload`).

---

## First-Time Configuration

Open the popup (click the extension icon) and fill in:

| Field | What to enter |
|-------|---------------|
| **GitHub Username** | Your GitHub handle (`octocat`). |
| **Repository** | Repo name (`leetcode-solutions`). |
| **Token** | PAT with appropriate scope. |
| **Branch** | Branch to push to (defaults to `main`). |

1. Click **Save**.
2. Click **Test Credentials** to verify permissions.
3. (Optional) Enter your **OpenAI API key** and hit **Save API Key**.
4. Click **Sync now** to index existing solutions from GitHub.

Once saved, settings live in `chrome.storage.local` (scoped to your browser profile).

---

## Key Features

### 1. Auto GitHub Push

- When you hit “Submit” on LeetCode and the solution is **Accepted**, GitCode captures the code and metadata.
- Files are stored under `solutions/<lang>/<Problem_Title>.<ext>`.
- Commit message: `Add/Update solution: <Problem Title>`.
- Handles retries and file SHA detection to avoid conflicts.

### 2. Repo-Aware RAG (Retrieval-Augmented Generation)

- Chrome popup button “Sync now” crawls your repo via GitHub Contents API.
- Solutions are cached in IndexedDB and tokenized with BM25.
- Requesting suggestions fetches top matches and packages them as references for GPT.

### 3. In-My-Style UI on LeetCode

- Floating “💡 In-My-Style” button on problem pages.
- Offers three modes: Skeleton, Skeleton + Hints, Full Draft.
- Extracts live context: title, difficulty, language, constraints, tags, your current code.
- Injects generated drafts back into Monaco or copies to clipboard.

---

## Using In-My-Style Suggestions

1. Navigate to a LeetCode problem and select your language (e.g., Python).
2. Click the floating **💡 In-My-Style** button.
3. Pick a mode:
   - **Skeleton** – Structured TODOs aligned with your style.
   - **Skeleton + Hints** – Adds strategic hints with partial code.
   - **Full Draft** – Complete solution mirroring your patterns.
4. Review the preview:
   - Insert directly into the editor.
   - Copy to clipboard.
5. Iterate or regenerate as needed.

> Pro tip: Use “Sync now” after committing new solutions to keep the RAG index fresh.

---

## RAG Pipeline Details

1. **Sync Stage** (`gc_sync_repo` message):
   - BFS through GitHub repo via Contents API (`getTreeEntries`).
   - Fetches every code file, normalizes into documents (`normalizeDoc`).
   - Caches docs + style metadata in IndexedDB (`gc_rag_db`).

2. **Query Stage** (`gc_rag_query` message):
   - Collects context from LeetCode DOM + user preferences.
   - Runs BM25 (`bm25Query`) to get top solutions (language-boosted).
   - Derives style hints (indentation, braces, comments, helper usage).
   - Constructs GPT prompt including references + style cues.
   - Returns generated code + referenced titles.

3. **LLM Call**:
   - Uses OpenAI Chat Completions API (model configurable via `OPENAI_CONFIG`).
   - Handles errors (401/403/429) with descriptive notifications.

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| **“GitHub credentials not set” notification** | Open popup, save username/repo/token/branch. |
| **Test Credentials fails (401/403)** | Check PAT scope and repo visibility. |
| **Sync shows 0 matched files** | Ensure repo has files under tracked languages/extensions. |
| **“Programming language not detected”** | Select a language in LeetCode editor before requesting suggestions. |
| **OpenAI errors (rate limits, auth)** | Verify API key, check console for status code. |
| **No In-My-Style button** | Reload page; the extension patches history to detect SPA navigations. |

Use Chrome DevTools → **Service Worker** console for detailed logs (`chrome://extensions → Inspect views`).

---

## FAQ

**Q: Does it support company-specific LeetCode variants?**  
A: Works on `leetcode.com` (and subpaths). For custom domains, add them in `manifest.json → host_permissions`.

**Q: Where are files stored in GitHub?**  
A: `solutions/<extension>/<Slugified_Title>.<ext>`. Extensions are mapped from language.

**Q: Can I use other LLM providers?**  
A: Currently wired to OpenAI’s Chat Completion endpoint; you can adapt `callOpenAI` for alternatives.

**Q: Is the OpenAI key stored securely?**  
A: Saved in `chrome.storage.local`; treat it like any extension-stored secret (browser profile scoped).

---

## Development Notes

- Manifest V3 service worker (`background.js`) handles all network operations.
- Content/page scripts communicate via `window.postMessage` → `chrome.runtime`.
- IndexedDB (`gc_rag_db`) holds documents and BM25 index.
- Styling for popup lives in `popup.css`; linked in `popup.html`.
- Icons reference `icon.png`.

### Scripts & Commands

```bash
# Format / lint (manual; no bundler required)
npm run lint   # if you add ESLint
npm run build  # optional: for future automation
```

Currently there’s no build step; everything ships as vanilla JS/CSS/HTML.

---

## Contributing

1. Fork the repo.
2. Create a feature branch (`git checkout -b feature/improve-rag`).
3. Commit changes with descriptive messages.
4. Submit a PR with screenshots/logs for UX or pipeline changes.

Please keep changes compatible with Manifest V3 and avoid introducing additional permissions without discussion.

---

## License

MIT License – see [`LICENSE`](LICENSE) (add one if missing).

---

Built for speed-runners who want their GitHub green squares to keep up with their LeetCode streak. 💪
