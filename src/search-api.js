// Optional search APIs for web_search (Brave, Tavily, Exa), so searches don't depend on scraping a results
// page that may answer with a robot check. Off unless the user adds a key in Settings; queries then go to that
// provider. Results are still shown to the user in a Skillerr tab (see resultsPage), so nothing happens unseen.

const PROVIDERS = {
  brave: {
    name: 'Brave Search',
    request: (q, max, key) => ({
      url: `https://api.search.brave.com/res/v1/web/search?${new URLSearchParams({ q, count: String(Math.min(max, 20)) })}`,
      init: { headers: { accept: 'application/json', 'x-subscription-token': key } },
    }),
    parse: (d) => (d?.web?.results || []).map((r) => ({ title: r.title, url: r.url, snippet: r.description })),
  },
  tavily: {
    name: 'Tavily',
    request: (q, max, key) => ({
      url: 'https://api.tavily.com/search',
      init: {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({ query: q, max_results: Math.min(max, 20), search_depth: 'basic' }),
      },
    }),
    parse: (d) => (d?.results || []).map((r) => ({ title: r.title, url: r.url, snippet: r.content })),
  },
  exa: {
    name: 'Exa',
    request: (q, max, key) => ({
      url: 'https://api.exa.ai/search',
      init: {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key },
        body: JSON.stringify({ query: q, numResults: Math.min(max, 20), contents: { summary: true } }),
      },
    }),
    parse: (d) => (d?.results || []).map((r) => ({ title: r.title, url: r.url, snippet: r.summary || r.text })),
  },
};

const clean = (s, n) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, n);

// → [{ title, url, snippet }]. Throws on a bad key, quota, network or timeout, so the caller can fall back.
async function searchApi({ provider, key, query, max = 8, fetchImpl = fetch, timeoutMs = 10000 }) {
  const p = PROVIDERS[provider];
  if (!p) throw new Error(`Unknown search provider: ${provider}`);
  if (!key) throw new Error(`No API key for ${p.name}`);
  const { url, init } = p.request(query, max, key);
  const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${p.name} answered ${res.status}`);
  return p.parse(await res.json())
    .filter((r) => /^https?:\/\//.test(r.url || ''))
    .slice(0, max)
    .map((r) => ({ title: clean(r.title, 200) || r.url, url: r.url, snippet: clean(r.snippet, 300) }));
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// A small results page for the tab, so the user sees what the AI got back.
function resultsPage(provider, query, results) {
  const items = results.map((r) => `<li><a href="${esc(r.url)}">${esc(r.title)}</a><cite>${esc(r.url)}</cite><p>${esc(r.snippet)}</p></li>`).join('');
  const html = `<!doctype html><meta charset="utf-8"><title>${esc(query)} · ${esc(PROVIDERS[provider]?.name || provider)}</title>
<style>:root{color-scheme:light dark}body{font:15px/1.5 system-ui,sans-serif;max-width:760px;margin:32px auto;padding:0 16px}
h1{font-size:18px;font-weight:600}small{color:GrayText}ol{padding-left:20px}li{margin:0 0 18px}a{font-size:16px}
cite{display:block;color:GrayText;font-style:normal;font-size:12px;overflow-wrap:anywhere}p{margin:4px 0 0}</style>
<h1>${esc(query)}</h1><small>Results from ${esc(PROVIDERS[provider]?.name || provider)}, searched by your AI in Skillerr</small><ol>${items}</ol>`;
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
}

module.exports = { searchApi, resultsPage, PROVIDERS };
