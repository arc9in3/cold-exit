// Hacker News top stories via Firebase API.
// Returns up to N items as { url, title, source, excerpt, score }.

const API = 'https://hacker-news.firebaseio.com/v0';

export async function fetchHN(limit = 30) {
  const idsRes = await fetch(`${API}/topstories.json`);
  if (!idsRes.ok) throw new Error(`HN topstories ${idsRes.status}`);
  const ids = (await idsRes.json()).slice(0, limit);
  // HN's per-item endpoint is fast but serial would take ~3s for 30
  // items. Parallel chunked fetch — 6 at a time keeps us under their
  // soft rate limit while finishing in well under a second.
  const items = [];
  const chunkSize = 6;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const fetched = await Promise.all(chunk.map(async (id) => {
      try {
        const r = await fetch(`${API}/item/${id}.json`);
        if (!r.ok) return null;
        return await r.json();
      } catch (_) { return null; }
    }));
    for (const it of fetched) {
      if (!it || it.dead || it.deleted) continue;
      // Self-posts (Ask HN, Show HN with text) keep the HN URL as the
      // canonical link; external links use the article URL.
      const url = it.url || `https://news.ycombinator.com/item?id=${it.id}`;
      items.push({
        url,
        title: it.title || '(untitled)',
        source: 'hn',
        excerpt: it.text ? _stripHtml(it.text).slice(0, 280) : null,
        score: it.score || 0,
      });
    }
  }
  return items;
}

function _stripHtml(html) {
  return String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
