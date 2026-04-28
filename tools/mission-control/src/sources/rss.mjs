// Generic RSS/Atom feed scraper. Uses rss-parser which handles both
// formats + a pile of vendor quirks (Medium, Substack, Atom, etc.).

import Parser from 'rss-parser';

const parser = new Parser({
  timeout: 15000,
  headers: { 'User-Agent': 'mission-control-bot/0.1' },
});

export async function fetchRSS(feedUrl, limit = 15) {
  const feed = await parser.parseURL(feedUrl);
  const items = [];
  for (const it of (feed.items || []).slice(0, limit)) {
    items.push({
      url: it.link || it.guid,
      title: it.title || '(untitled)',
      source: `rss:${_sourceLabel(feedUrl)}`,
      excerpt: it.contentSnippet ? it.contentSnippet.slice(0, 280) : null,
      score: 0,    // RSS has no native score — Newsie applies its own ranking
    });
  }
  return items;
}

function _sourceLabel(feedUrl) {
  try {
    const u = new URL(feedUrl);
    return u.hostname.replace(/^www\./, '');
  } catch (_) {
    return feedUrl;
  }
}
