# Reddit OSINT Collector

A human-in-the-loop browser extension that passively collects Reddit post and comment data while you browse normally. Based on the [X-Human-in-the-Loop-Scraper](https://github.com/As-Foretold-Research-Labs/X-Human-in-the-Loop-Scraper) pattern, adapted for Reddit.

## How it works

The extension runs silently in the background as you browse Reddit. It observes DOM mutations to detect newly rendered posts and comments (including infinite-scroll content), extracts structured data, deduplicates records, and stores them locally in IndexedDB. Optionally, batches can be forwarded to an external webhook in real time.

**Supported sites:** `www.reddit.com` (new Reddit — web components) and `old.reddit.com` (classic Reddit layout).

```
Reddit (DOM)
    ↓  MutationObserver
content.js  →  extracts posts & comments
    ↓  chrome.runtime.sendMessage (batched every 5 s)
background.js  →  IndexedDB (local storage)
                →  Webhook (optional: n8n / Supabase / custom)
                →  Notion sync (optional: fetch target subreddits every 5 min)
    ↓
popup.js  →  display stats, export JSON/CSV
```

## Features

- **Passive collection** — works while you browse; no manual intervention needed
- **New Reddit & Old Reddit** — supports both `www.reddit.com` (shreddit web components) and `old.reddit.com`
- **Posts and comments** — collects both; comment collection can be toggled off
- **Deduplication** — never stores the same URL twice
- **Rich metadata** per post: title, author, subreddit, score, comment count, flair, timestamp, post type, NSFW flag, text body
- **Rich metadata** per comment: author, subreddit, score, depth, text, timestamp
- **Page context filtering** — choose which page types to collect from: Home, Subreddit, Post detail, Profile, Search
- **Subreddit filter** — limit collection to specific subreddits
- **User filter** — limit collection to specific users
- **Keyword filter** — only collect items where the title/text contains at least one keyword
- **Notion integration** — fetch a target subreddit list from a Notion database (synced every 5 minutes); overrides the subreddit filter
- **Webhook forwarding** — POST batches to any HTTP endpoint (n8n, Supabase, custom)
- **Export** — download all collected data as JSON or CSV from the popup
- **Cross-browser** — Chrome/Edge (Manifest V3) and Firefox (Manifest V2)

## Collected data fields

### Posts

| Field | Description |
|-------|-------------|
| `type` | `"post"` |
| `url` | Canonical permalink |
| `title` | Post title |
| `author` | `u/username` |
| `subreddit` | `r/subreddit` |
| `score` | Vote score (may be fuzzed by Reddit) |
| `commentCount` | Number of comments |
| `postId` | Full Reddit post ID |
| `timestamp` | Creation time (ISO 8601) |
| `domain` | Link domain (for link posts) |
| `postType` | `link`, `text`, `image`, `video`, `gallery`, etc. |
| `flairText` | Post flair text |
| `isNsfw` | Boolean |
| `postText` | Self-text body (for text posts) |
| `pageContext` | `home`, `subreddit`, `post`, `profile`, or `search` |
| `collectedAt` | Time the record was stored (ISO 8601) |

### Comments

| Field | Description |
|-------|-------------|
| `type` | `"comment"` |
| `url` | Permalink to the comment |
| `author` | `u/username` |
| `subreddit` | `r/subreddit` |
| `score` | Vote score |
| `depth` | Nesting level (0 = top-level) |
| `thingId` | Reddit thing ID |
| `timestamp` | Creation time (ISO 8601) |
| `text` | Comment body text |
| `pageContext` | Always `post` |
| `collectedAt` | Time the record was stored (ISO 8601) |

## Installation

### Chrome / Edge (Manifest V3)

1. Clone or download this repository
2. Go to `chrome://extensions/`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select the repository folder
5. The 🤖 icon appears in your toolbar — browse Reddit to start collecting

### Firefox (Manifest V2)

1. Go to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Select **`manifest-firefox.json`** from the repository folder

> **Note:** Firefox temporary add-ons are removed on browser restart. For permanent installation, sign the extension via [addons.mozilla.org](https://addons.mozilla.org/developers/).

## Configuration

Click the ⚙ Settings link in the popup (or right-click the toolbar icon → Options).

| Setting | Default | Description |
|---------|---------|-------------|
| Auto-collect on page load | ✅ on | Automatically start collecting when a Reddit page loads |
| Collect comments | ✅ on | Also collect comments, not just posts |
| Page contexts | all | Which page types to collect from |
| Subreddit filter | (empty) | Comma-separated subreddit names; empty = collect all |
| User filter | (empty) | Comma-separated usernames; empty = collect all |
| Keyword filter | (empty) | At least one keyword must match the title/text |
| Webhook URL | (empty) | Endpoint to POST batches to |
| Enable webhook | ❌ off | Toggle webhook forwarding |
| Notion integration | ❌ off | Sync target subreddit list from Notion |
| Notion API key | (empty) | Notion internal integration secret |
| Notion database ID | (empty) | ID of the Notion database containing target subreddits |

### Notion database schema

Create a Notion database with a property named **`Subreddit`** (rich text or title type). Each row should contain a subreddit name (e.g. `r/Python` or just `Python`). When Notion integration is enabled, this list overrides the subreddit filter text field.

## Exporting data

Open the popup and click:
- **Export JSON** — downloads `reddit_osint_items.json`
- **Export CSV** — downloads `reddit_osint_items.csv`

## Privacy

All data is stored **locally** in your browser's IndexedDB. Nothing is sent externally unless you configure a webhook. The extension only runs on `*.reddit.com` pages.

## File overview

| File | Purpose |
|------|---------|
| `manifest.json` | Chrome/Edge extension manifest (MV3) |
| `manifest-firefox.json` | Firefox extension manifest (MV2) |
| `selectors.js` | Centralised DOM selectors for new and old Reddit |
| `content.js` | Content script: MutationObserver, extraction, filtering, batching |
| `background.js` | Service worker: IndexedDB storage, webhook, Notion sync |
| `popup.html` / `popup.js` | Toolbar popup UI |
| `options.html` / `options.js` | Settings page |

