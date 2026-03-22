// Centralized DOM selectors for Reddit scraping.
// Supports both new Reddit (www.reddit.com, web components) and old Reddit (old.reddit.com).
// Prefers semantic attributes and custom-element tag names over fragile class names.

(function () {
  window.REDDIT_OSINT_SELECTORS = {

    // ── New Reddit (www.reddit.com) ──────────────────────────────────────────
    // Posts are rendered as <shreddit-post> custom elements with rich attributes.
    newRedditPost: 'shreddit-post',

    // Comments are rendered as <shreddit-comment> custom elements.
    newRedditComment: 'shreddit-comment',

    // Post title inside a shreddit-post (slot or heading link).
    newPostTitle: '[slot="title"], h1, h3, a[id^="post-title-"]',

    // Text body of a text post.
    newPostBody: '[slot="text-body"], .RichTextJSON-root',

    // Timestamp element with ISO datetime (shared with old Reddit).
    time: 'time[datetime], faceplate-timeago',

    // ── Old Reddit (old.reddit.com) ──────────────────────────────────────────
    // Posts are .thing.link divs with data-* attributes.
    oldRedditPost: '.thing.link, .thing.self',

    // Comment elements in old Reddit.
    oldRedditComment: '.comment',

    // Title link in old Reddit.
    oldPostTitle: 'a.title',

    // Author link (shared pattern: href contains /user/).
    authorLink: 'a[href*="/user/"], a.author',

    // Subreddit link.
    subredditLink: 'a[href*="/r/"]',

    // Vote score.
    scoreEl: '.score, .likes',

    // Comment count link.
    commentCountLink: 'a.comments',

    // Post flair.
    flairEl: '.linkFlairText, .flair',

    // ── Shared / fallback ────────────────────────────────────────────────────
    // Any images inside a post (preview thumbnails, inline images).
    image: 'img',

    // External link on a link post.
    externalLink: 'a[data-click-id="body"][href^="http"], a.title[href^="http"]'
  };
})();
