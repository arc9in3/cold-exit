// GitHub trending — there's no official API, so we scrape the HTML of
// https://github.com/trending. Light parsing via regex; we deliberately
// avoid pulling in cheerio for one selector.

const UA = 'mission-control-bot/0.1';

export async function fetchGithubTrending(language = '', limit = 15) {
  const path = language
    ? `https://github.com/trending/${encodeURIComponent(language)}?since=daily`
    : `https://github.com/trending?since=daily`;
  const res = await fetch(path, { headers: { 'User-Agent': UA, 'Accept': 'text/html' } });
  if (!res.ok) throw new Error(`github trending ${res.status}`);
  const html = await res.text();
  const items = [];
  // Each repo card lives in a <article class="Box-row"> ... </article>.
  // Inside, the <h2> wraps an <a href="/owner/repo">. We extract those
  // hrefs in document order — that IS the trending order.
  const re = /<h2[^>]*>\s*<a[^>]*href="\/([^"]+)"/g;
  const seen = new Set();
  let m;
  while ((m = re.exec(html)) && items.length < limit) {
    const slug = m[1].split(/[?#]/)[0].trim();
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    // Pull the description if present (the next <p class="col-9 ...">
    // after the heading). Best-effort; missing descriptions are fine.
    const after = html.slice(m.index, m.index + 2000);
    const descMatch = after.match(/<p[^>]*class="col-9[^"]*"[^>]*>([\s\S]*?)<\/p>/);
    const excerpt = descMatch
      ? descMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 280)
      : null;
    items.push({
      url: `https://github.com/${slug}`,
      title: slug.replace('/', ' / '),
      source: language ? `github-trending:${language}` : 'github-trending',
      excerpt,
      score: 0,
    });
  }
  return items;
}
