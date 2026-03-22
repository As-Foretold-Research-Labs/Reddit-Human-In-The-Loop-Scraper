// Content script: watches for new Reddit posts and comments and extracts data.
// Works on both new Reddit (www.reddit.com) and old Reddit (old.reddit.com).
// Uses selectors from selectors.js (window.REDDIT_OSINT_SELECTORS).

(function () {
  const S = window.REDDIT_OSINT_SELECTORS || {};

  let running = true;
  let seen = new Set(); // dedupe by URL within this content session
  let batch = [];

  // Settings (loaded from chrome.storage.sync)
  let settings = {
    webhookEnabled: false,
    webhookUrl: '',
    autoCollect: true,
    contexts: ['home', 'subreddit', 'post', 'profile', 'search'],
    subredditFilter: '',
    userFilter: '',
    keywordFilter: '',
    collectComments: true,
    notionSubreddits: []
  };

  function loadSettings() {
    chrome.storage.sync.get(settings, (items) => {
      settings = Object.assign(settings, items);
      chrome.storage.local.get({ active: !!settings.autoCollect, notionSubreddits: [] }, (local) => {
        running = !!local.active;
        settings.notionSubreddits = local.notionSubreddits || [];
      });
    });
  }
  loadSettings();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync') {
      loadSettings();
    }
    if (area === 'local' && changes.active) {
      running = !!changes.active.newValue;
    }
  });

  // Send batch every 5 seconds
  setInterval(() => {
    if (batch.length > 0) {
      chrome.runtime.sendMessage({ type: 'redditBatch', items: batch }, () => {});
      batch = [];
    }
  }, 5000);

  // Pause / resume from popup
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'pause') {
      running = false;
      sendResponse({ ok: true });
    } else if (msg && msg.type === 'resume') {
      running = true;
      sendResponse({ ok: true });
    }
  });

  // ── Helpers ──────────────────────────────────────────────────────────────

  function isNewReddit() {
    return location.hostname === 'www.reddit.com' || location.hostname === 'reddit.com';
  }

  function isOldReddit() {
    return location.hostname === 'old.reddit.com';
  }

  function pageContextFromUrl(url) {
    try {
      const u = new URL(url);
      const p = u.pathname;
      if (/^\/r\/[^/]+\/comments\//.test(p)) return 'post';
      if (/^\/r\/[^/]+(\/((hot|new|rising|top|controversial|best)\/?)?)?$/.test(p)) return 'subreddit';
      if (/^\/(u|user)\//.test(p)) return 'profile';
      if (/^\/search/.test(p)) return 'search';
      if (p === '/' || /^\/(hot|new|rising|top|best)\/?$/.test(p)) return 'home';
      if (/^\/r\/(all|popular)(\/|$)/.test(p)) return 'home';
      return 'unknown';
    } catch (e) {
      return 'unknown';
    }
  }

  function passesContextFilter(pageContext) {
    if (!settings.contexts || !settings.contexts.length) return true;
    return settings.contexts.includes(pageContext);
  }

  function passesSubredditFilter(subreddit) {
    const sub = (subreddit || '').replace(/^r\//, '').toLowerCase();
    if (settings.notionSubreddits && settings.notionSubreddits.length) {
      return settings.notionSubreddits.some(s => s.replace(/^r\//, '').toLowerCase() === sub);
    }
    if (settings.subredditFilter && settings.subredditFilter.trim()) {
      const allowed = settings.subredditFilter.split(',')
        .map(s => s.trim().replace(/^r\//, '').toLowerCase()).filter(Boolean);
      if (allowed.length) return allowed.includes(sub);
    }
    return true;
  }

  function passesUserFilter(author) {
    if (!settings.userFilter || !settings.userFilter.trim()) return true;
    const allowed = settings.userFilter.split(',')
      .map(s => s.trim().replace(/^u\//, '').toLowerCase()).filter(Boolean);
    if (!allowed.length) return true;
    return allowed.includes((author || '').toLowerCase());
  }

  function passesKeywordFilter(text) {
    if (!settings.keywordFilter || !settings.keywordFilter.trim()) return true;
    const kws = settings.keywordFilter.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    if (!kws.length) return true;
    const lower = (text || '').toLowerCase();
    return kws.some(k => lower.includes(k));
  }

  // ── New Reddit: <shreddit-post> ──────────────────────────────────────────

  function extractNewRedditPost(el) {
    const permalink = el.getAttribute('permalink') || el.getAttribute('content-href') || '';
    if (!permalink || !permalink.includes('/comments/')) return null;
    const url = 'https://www.reddit.com' + permalink.split('?')[0];
    if (seen.has(url)) return null;

    const author = el.getAttribute('author') || '';
    const subreddit = el.getAttribute('subreddit-prefixed-name') || '';
    const scoreRaw = el.getAttribute('score');
    const score = scoreRaw !== null ? parseInt(scoreRaw, 10) || 0 : null;
    const commentCount = parseInt(el.getAttribute('comment-count') || '0', 10);
    const postId = el.getAttribute('post-id') || '';
    const createdTimestamp = el.getAttribute('created-timestamp') || '';
    const domain = el.getAttribute('domain') || '';
    const postType = el.getAttribute('post-type') || 'link';
    const flairText = el.getAttribute('flair-text') || '';
    const isNsfw = el.hasAttribute('is-nsfw');

    // Title
    let title = '';
    const titleEl = el.querySelector(S.newPostTitle || '[slot="title"], h1, h3');
    if (titleEl) title = (titleEl.innerText || titleEl.textContent || '').trim();

    // Text body (text posts)
    let postText = '';
    const bodyEl = el.querySelector(S.newPostBody || '[slot="text-body"], .RichTextJSON-root');
    if (bodyEl) postText = (bodyEl.innerText || '').trim();

    const pageContext = pageContextFromUrl(location.href);

    if (!passesContextFilter(pageContext)) return null;
    if (!passesSubredditFilter(subreddit)) return null;
    if (!passesUserFilter(author)) return null;
    if (!passesKeywordFilter(title + ' ' + postText)) return null;

    seen.add(url);
    return {
      type: 'post',
      url,
      title: title || '',
      author: author ? 'u/' + author : '',
      subreddit: subreddit || '',
      score,
      commentCount,
      postId,
      timestamp: createdTimestamp || new Date().toISOString(),
      domain,
      postType,
      flairText,
      isNsfw,
      postText,
      pageContext
    };
  }

  // ── New Reddit: <shreddit-comment> ───────────────────────────────────────

  function extractNewRedditComment(el) {
    if (!settings.collectComments) return null;
    const permalink = el.getAttribute('permalink') || '';
    if (!permalink) return null;
    const url = 'https://www.reddit.com' + permalink.split('?')[0];
    if (seen.has(url)) return null;

    const author = el.getAttribute('author') || '';
    const thingId = el.getAttribute('thingid') || el.getAttribute('comment-id') || '';
    const scoreRaw = el.getAttribute('score');
    const score = scoreRaw !== null ? parseInt(scoreRaw, 10) || 0 : null;
    const depth = parseInt(el.getAttribute('depth') || '0', 10);
    const createdTimestamp = el.getAttribute('created-timestamp') || '';
    const subreddit = el.getAttribute('subreddit-prefixed-name') ||
      el.closest(S.newRedditPost || 'shreddit-post')?.getAttribute('subreddit-prefixed-name') || '';

    // Comment text
    let text = '';
    const bodyEl = el.querySelector('[slot="comment"] .RichTextJSON-root, [id^="comment-rtjson"], p');
    if (bodyEl) {
      text = (bodyEl.innerText || '').trim();
    } else {
      text = (el.innerText || '').trim().slice(0, 500);
    }

    const pageContext = pageContextFromUrl(location.href);

    if (!passesContextFilter(pageContext)) return null;
    if (!passesSubredditFilter(subreddit)) return null;
    if (!passesUserFilter(author)) return null;
    if (!passesKeywordFilter(text)) return null;

    seen.add(url);
    return {
      type: 'comment',
      url,
      author: author ? 'u/' + author : '',
      subreddit,
      score,
      depth,
      thingId,
      timestamp: createdTimestamp || new Date().toISOString(),
      text,
      pageContext
    };
  }

  // ── Old Reddit: .thing.link / .thing.self ────────────────────────────────

  function extractOldRedditPost(el) {
    const permalink = el.getAttribute('data-permalink') || '';
    if (!permalink) return null;
    const url = 'https://old.reddit.com' + permalink.split('?')[0];
    if (seen.has(url)) return null;

    const author = el.getAttribute('data-author') || '';
    const subreddit = el.getAttribute('data-subreddit') || '';
    const postId = el.getAttribute('data-fullname') || '';
    const domain = el.getAttribute('data-domain') || '';
    const isNsfw = el.classList.contains('over18') || el.getAttribute('data-nsfw') === 'true';

    // Title
    let title = '';
    const titleEl = el.querySelector(S.oldPostTitle || 'a.title');
    if (titleEl) title = (titleEl.innerText || titleEl.textContent || '').trim();

    // Score
    let score = null;
    const scoreEl = el.querySelector('.score.unvoted, .score.likes, .score.dislikes');
    if (scoreEl) {
      const raw = scoreEl.getAttribute('title') || scoreEl.innerText || '';
      const parsed = parseInt(raw.replace(/,/g, ''), 10);
      if (!isNaN(parsed)) score = parsed;
    }

    // Comment count
    let commentCount = 0;
    const commentLink = el.querySelector(S.commentCountLink || 'a.comments');
    if (commentLink) {
      const m = (commentLink.innerText || '').match(/(\d[\d,]*)/);
      if (m) commentCount = parseInt(m[1].replace(/,/g, ''), 10);
    }

    // Timestamp
    let timestamp = '';
    const timeEl = el.querySelector('time[datetime]');
    if (timeEl) {
      const dt = timeEl.getAttribute('datetime');
      timestamp = dt ? new Date(dt).toISOString() : '';
    }

    // Flair
    let flairText = '';
    const flairEl = el.querySelector(S.flairEl || '.linkFlairText, .flair');
    if (flairEl) flairText = (flairEl.innerText || '').trim();

    const pageContext = pageContextFromUrl(location.href);

    if (!passesContextFilter(pageContext)) return null;
    if (!passesSubredditFilter(subreddit)) return null;
    if (!passesUserFilter(author)) return null;
    if (!passesKeywordFilter(title)) return null;

    seen.add(url);
    return {
      type: 'post',
      url,
      title,
      author: author ? 'u/' + author : '',
      subreddit: subreddit ? 'r/' + subreddit : '',
      score,
      commentCount,
      postId,
      timestamp: timestamp || new Date().toISOString(),
      domain,
      postType: el.classList.contains('self') ? 'text' : 'link',
      flairText,
      isNsfw,
      postText: '',
      pageContext
    };
  }

  // ── Old Reddit: .comment ─────────────────────────────────────────────────

  function extractOldRedditComment(el) {
    if (!settings.collectComments) return null;
    const thingId = el.getAttribute('data-fullname') || '';
    const author = el.getAttribute('data-author') || '';
    const subreddit = el.getAttribute('data-subreddit') || '';
    const permalink = el.querySelector('a.bylink, .flat-list.buttons a[href*="/comments/"]');
    const rawPermalink = permalink ? permalink.getAttribute('href') || '' : '';
    if (!rawPermalink) return null;
    const url = rawPermalink.startsWith('http') ? rawPermalink.split('?')[0]
      : 'https://old.reddit.com' + rawPermalink.split('?')[0];
    if (seen.has(url)) return null;

    let score = null;
    const scoreEl = el.querySelector('.score.unvoted, .score.likes, .score.dislikes');
    if (scoreEl) {
      const raw = scoreEl.getAttribute('title') || scoreEl.innerText || '';
      const parsed = parseInt(raw.replace(/,/g, ''), 10);
      if (!isNaN(parsed)) score = parsed;
    }

    let timestamp = '';
    const timeEl = el.querySelector('time[datetime]');
    if (timeEl) {
      const dt = timeEl.getAttribute('datetime');
      timestamp = dt ? new Date(dt).toISOString() : '';
    }

    let text = '';
    const bodyEl = el.querySelector('.usertext-body .md');
    if (bodyEl) text = (bodyEl.innerText || '').trim();

    const depth = parseInt(el.getAttribute('data-depth') || '0', 10);
    const pageContext = pageContextFromUrl(location.href);

    if (!passesContextFilter(pageContext)) return null;
    if (!passesSubredditFilter(subreddit)) return null;
    if (!passesUserFilter(author)) return null;
    if (!passesKeywordFilter(text)) return null;

    seen.add(url);
    return {
      type: 'comment',
      url,
      author: author ? 'u/' + author : '',
      subreddit: subreddit ? 'r/' + subreddit : '',
      score,
      depth,
      thingId,
      timestamp: timestamp || new Date().toISOString(),
      text,
      pageContext
    };
  }

  // ── Node processing ──────────────────────────────────────────────────────

  function processNode(node) {
    if (!running) return;
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return;
    try {
      // New Reddit posts
      if (isNewReddit()) {
        const posts = node.matches(S.newRedditPost || 'shreddit-post')
          ? [node]
          : Array.from(node.querySelectorAll ? node.querySelectorAll(S.newRedditPost || 'shreddit-post') : []);
        for (const p of posts) {
          const data = extractNewRedditPost(p);
          if (data) batch.push(data);
        }

        // New Reddit comments
        const comments = node.matches(S.newRedditComment || 'shreddit-comment')
          ? [node]
          : Array.from(node.querySelectorAll ? node.querySelectorAll(S.newRedditComment || 'shreddit-comment') : []);
        for (const c of comments) {
          const data = extractNewRedditComment(c);
          if (data) batch.push(data);
        }
      }

      // Old Reddit posts
      if (isOldReddit()) {
        const selector = S.oldRedditPost || '.thing.link, .thing.self';
        const posts = (node.matches && node.matches(selector))
          ? [node]
          : Array.from(node.querySelectorAll ? node.querySelectorAll(selector) : []);
        for (const p of posts) {
          const data = extractOldRedditPost(p);
          if (data) batch.push(data);
        }

        // Old Reddit comments
        const cSelector = S.oldRedditComment || '.comment';
        const comments = (node.matches && node.matches(cSelector))
          ? [node]
          : Array.from(node.querySelectorAll ? node.querySelectorAll(cSelector) : []);
        for (const c of comments) {
          const data = extractOldRedditComment(c);
          if (data) batch.push(data);
        }
      }
    } catch (e) {
      // ignore per-node errors
    }
  }

  function initialScan() {
    if (isNewReddit()) {
      document.querySelectorAll(S.newRedditPost || 'shreddit-post').forEach(p => {
        const data = extractNewRedditPost(p);
        if (data) batch.push(data);
      });
      document.querySelectorAll(S.newRedditComment || 'shreddit-comment').forEach(c => {
        const data = extractNewRedditComment(c);
        if (data) batch.push(data);
      });
    }
    if (isOldReddit()) {
      document.querySelectorAll(S.oldRedditPost || '.thing.link, .thing.self').forEach(p => {
        const data = extractOldRedditPost(p);
        if (data) batch.push(data);
      });
      document.querySelectorAll(S.oldRedditComment || '.comment').forEach(c => {
        const data = extractOldRedditComment(c);
        if (data) batch.push(data);
      });
    }
  }

  // MutationObserver watches for dynamically loaded content (infinite scroll, comment expansion)
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.addedNodes && m.addedNodes.length) {
        m.addedNodes.forEach(n => processNode(n));
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // Run initial scan after page is ready
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', initialScan);
  } else {
    initialScan();
  }

  // Expose debug API
  window.__REDDIT_OSINT = {
    seen,
    getBatch: () => batch.slice(),
    flush: () => {
      if (batch.length) {
        chrome.runtime.sendMessage({ type: 'redditBatch', items: batch }, () => {});
        batch = [];
      }
    }
  };

})();
