// Subreddit hot/new via Reddit's public JSON. No auth required for
// read-only public subs, but they DO require a non-default User-Agent
// or they 429. Be a good citizen.

const UA = 'mission-control-bot/0.1 (+local; non-commercial)';

export async function fetchSubreddit(name, { limit = 20, sort = 'hot' } = {}) {
  const url = `https://www.reddit.com/r/${name}/${sort}.json?limit=${limit}&raw_json=1`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
  if (!res.ok) {
    // 429s are common when calling Reddit too fast — caller should
    // sleep + retry, not crash the morning digest.
    throw new Error(`reddit r/${name} ${res.status}`);
  }
  const json = await res.json();
  const posts = json.data?.children || [];
  const items = [];
  for (const c of posts) {
    const p = c.data;
    if (!p || p.stickied || p.over_18) continue;
    // Self-posts use the reddit permalink; link posts use the linked URL.
    const url = p.is_self
      ? `https://www.reddit.com${p.permalink}`
      : (p.url_overridden_by_dest || `https://www.reddit.com${p.permalink}`);
    items.push({
      url,
      title: p.title,
      source: `reddit:${name}`,
      excerpt: p.selftext ? p.selftext.slice(0, 280) : null,
      score: p.score || 0,
    });
  }
  return items;
}
