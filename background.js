// Background service worker: stores Reddit posts/comments in IndexedDB and forwards to webhook.

const DB_NAME = 'reddit_osint_db';
const DB_VERSION = 1;
const STORE_NAME = 'items';

let sessionCount = 0;

// Notion sync: cached list of target subreddits from a Notion database
let notionSubreddits = [];

async function fetchNotionSubredditsOnce() {
  try {
    const cfg = await new Promise((res) =>
      chrome.storage.sync.get({ notionEnabled: false, notionApiKey: '', notionDatabaseId: '' }, res)
    );
    if (!cfg.notionEnabled || !cfg.notionApiKey || !cfg.notionDatabaseId) return;

    const url = `https://api.notion.com/v1/databases/${cfg.notionDatabaseId}/query`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + cfg.notionApiKey,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ page_size: 100 })
    });
    if (!resp.ok) throw new Error('Notion fetch failed ' + resp.status);
    const data = await resp.json();
    const pages = data.results || [];
    const subreddits = [];

    for (const p of pages) {
      const props = p.properties || {};
      // Look for a property named "Subreddit"
      const prop = props.Subreddit || props.subreddit;
      if (prop) {
        let val = '';
        if (prop.type === 'rich_text' && prop.rich_text && prop.rich_text.length) {
          val = prop.rich_text.map(t => t.plain_text).join('');
        } else if (prop.type === 'title' && prop.title && prop.title.length) {
          val = prop.title.map(t => t.plain_text).join('');
        } else if (prop.type === 'url' && prop.url) {
          val = prop.url;
        }
        if (val) {
          let s = val.trim();
          // Normalize: extract subreddit name from a reddit.com URL if present
          if (s.includes('reddit.com/r/')) {
            try {
              const u = new URL(s.startsWith('http') ? s : 'https://' + s);
              const m = u.pathname.match(/\/r\/([^/]+)/);
              if (m) s = m[1];
            } catch (e) { /* ignore */ }
          }
          s = s.replace(/^r\//, '').toLowerCase();
          if (s) subreddits.push('r/' + s);
        }
      } else {
        // Fallback: scan all properties for something that looks like a subreddit name
        for (const k of Object.keys(props)) {
          const p2 = props[k];
          if (p2 && (p2.type === 'rich_text' || p2.type === 'title')) {
            const text = (p2.rich_text || p2.title || []).map(t => t.plain_text).join('');
            const m = text.match(/r\/([A-Za-z0-9_]{2,21})/);
            if (m) { subreddits.push('r/' + m[1].toLowerCase()); break; }
          }
        }
      }
    }

    const uniq = Array.from(new Set(subreddits));
    notionSubreddits = uniq;
    chrome.storage.local.set({ notionSubreddits: uniq });
  } catch (e) {
    console.error('Notion sync error', e);
  }
}

// Sync Notion every 5 minutes (only runs the fetch when enabled)
setInterval(() => { fetchNotionSubredditsOnce(); }, 5 * 60 * 1000);
fetchNotionSubredditsOnce();

// ── IndexedDB ────────────────────────────────────────────────────────────────

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'url' });
        store.createIndex('collectedAt', 'collectedAt', { unique: false });
        store.createIndex('type', 'type', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function storeItems(items) {
  if (!items || !items.length) return { inserted: 0 };
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    let inserted = 0;
    tx.oncomplete = () => resolve({ inserted });
    tx.onerror = () => reject(tx.error);
    for (const item of items) {
      const getReq = store.get(item.url);
      getReq.onsuccess = () => {
        if (!getReq.result) {
          const rec = Object.assign({}, item, { collectedAt: new Date().toISOString() });
          store.add(rec);
          inserted++;
        }
      };
      getReq.onerror = () => { /* ignore */ };
    }
  });
}

// ── Webhook forwarding ────────────────────────────────────────────────────────

async function forwardToWebhook(items) {
  try {
    const settings = await new Promise((res) =>
      chrome.storage.sync.get({ webhookEnabled: false, webhookUrl: '' }, res)
    );
    if (!settings.webhookEnabled || !settings.webhookUrl) return { ok: false, reason: 'disabled' };
    const payload = JSON.stringify({ items });
    const doPost = async () => {
      const resp = await fetch(settings.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      });
      if (!resp.ok) throw new Error('bad response ' + resp.status);
      return { ok: true };
    };
    try {
      return await doPost();
    } catch (e) {
      // Retry once
      try { return await doPost(); } catch (e2) { return { ok: false, reason: e2.message }; }
    }
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

// ── Counts & badge ─────────────────────────────────────────────────────────────

function addToTotalCount(n) {
  chrome.storage.local.get({ totalCollected: 0 }, (items) => {
    chrome.storage.local.set({ totalCollected: (items.totalCollected || 0) + n });
  });
}

function setBadge(count) {
  const text = count > 0 ? String(count) : '';
  try { if (chrome.action && chrome.action.setBadgeText) chrome.action.setBadgeText({ text }); } catch (e) { /* ignore */ }
  try { if (chrome.browserAction && chrome.browserAction.setBadgeText) chrome.browserAction.setBadgeText({ text }); } catch (e) { /* ignore */ }
}

// ── Message handlers ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;

  if (msg.type === 'redditBatch') {
    const items = Array.isArray(msg.items) ? msg.items : [];
    (async () => {
      try {
        const res = await storeItems(items);
        if (res.inserted > 0) {
          sessionCount += res.inserted;
          addToTotalCount(res.inserted);
          setBadge(sessionCount);
          try { await forwardToWebhook(items); } catch (e) { /* ignore */ }
        }
      } catch (e) {
        console.error('storeItems error', e);
      }
    })();
    sendResponse({ received: true });
    return true;
  }

  if (msg.type === 'resetSessionCount') {
    sessionCount = 0;
    setBadge(0);
    sendResponse({ ok: true });
  }

  if (msg.type === 'getSessionCount') {
    sendResponse({ sessionCount });
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get({ totalCollected: 0 }, (items) => {
    if (typeof items.totalCollected === 'undefined') {
      chrome.storage.local.set({ totalCollected: 0 });
    }
  });
});
