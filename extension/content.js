(() => {
  const api = typeof browser !== 'undefined' ? browser : chrome;
  let currentKey = null;
  let generation = 0;
  let visit = null;
  let extractionTimer = null;
  let lastEnrichment = '';

  function statusFromLocation() {
    const match = location.pathname.match(/^\/([^/]+)\/status\/(\d+)(?:\/|$)/i);
    if (!match) return null;
    return {
      id: match[2],
      author: match[1],
      url: location.origin + '/' + match[1] + '/status/' + match[2],
      visitedAt: new Date().toISOString()
    };
  }

  function send(record) {
    try {
      const result = api.runtime.sendMessage({ type: 'upsert', record });
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch (_) { /* The extension may have been reloaded. */ }
  }

  function findPost(id) {
    // The timestamp belongs to the post itself, unlike links inside quoted posts.
    for (const time of document.querySelectorAll('article time')) {
      const link = time.closest('a[href]');
      if (!link) continue;
      let path;
      try { path = new URL(link.href, location.href).pathname; } catch (_) { continue; }
      const match = path.match(/^\/[^/]+\/status\/(\d+)(?:\/|$)/i);
      if (match && match[1] === id) return time.closest('article');
    }
    return null;
  }

  function extractMedia(article) {
    if (typeof article.querySelectorAll !== 'function') return [];
    const media = [];
    const seen = new Set();
    const add = (type, value) => {
      if (!value || media.length >= 8) return;
      try {
        const url = new URL(value, location.href);
        if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'pbs.twimg.com' ||
            !/^\/(?:media|ext_tw_video_thumb|amplify_video_thumb|tweet_video_thumb)\//.test(url.pathname)) return;
        if (url.searchParams.has('name')) url.searchParams.set('name', 'large');
        const href = url.href;
        if (!seen.has(href)) { seen.add(href); media.push({ type, url: href }); }
      } catch (_) { /* Ignore malformed or non-X media URLs. */ }
    };

    for (const video of article.querySelectorAll('video[poster]')) add('video', video.poster || video.getAttribute('poster'));
    for (const image of article.querySelectorAll('img[src]')) add('image', image.currentSrc || image.src || image.getAttribute('src'));
    return media;
  }

  function extract(expectedGeneration) {
    extractionTimer = null;
    if (!visit || expectedGeneration !== generation) return;
    const atLocation = statusFromLocation();
    if (!atLocation || atLocation.id !== visit.id || atLocation.url !== visit.url) return;
    const article = findPost(visit.id);
    if (!article) return;
    const textNode = article.querySelector('[data-testid="tweetText"]');
    const text = textNode ? (textNode.innerText || textNode.textContent || '').trim() : '';
    const user = article.querySelector('[data-testid="User-Name"]');
    const authorText = user ? (user.innerText || user.textContent || '').trim() : '';
    // Keep the URL-derived handle stable; display names may contain unrelated badges.
    const record = { ...visit, text, title: document.title || '', author: visit.author, media: extractMedia(article) };
    if (!text && !authorText) return;
    const signature = JSON.stringify(record);
    if (signature !== lastEnrichment) {
      lastEnrichment = signature;
      send(record);
    }
  }

  function scheduleExtract() {
    if (!visit || extractionTimer !== null) return;
    const expectedGeneration = generation;
    extractionTimer = setTimeout(() => extract(expectedGeneration), 150);
  }

  function checkNavigation() {
    const next = statusFromLocation();
    const key = next ? next.url : null;
    if (key === currentKey) return;
    currentKey = key;
    generation += 1;
    if (extractionTimer !== null) clearTimeout(extractionTimer);
    extractionTimer = null;
    lastEnrichment = '';
    visit = next;
    if (visit) {
      send(visit); // Persist the visit before the SPA has rendered the post.
      scheduleExtract();
    }
  }

  function onChange() {
    checkNavigation();
    scheduleExtract();
  }

  // History events cover normal browser navigation; DOM observation and polling
  // also cover SPA pushState/replaceState calls made in the page's own world.
  addEventListener('popstate', onChange);
  addEventListener('hashchange', onChange);
  new MutationObserver(onChange).observe(document, { childList: true, subtree: true, characterData: true });
  setInterval(onChange, 1000);
  onChange();
})();
