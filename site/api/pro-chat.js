// Skillerr Pro: OpenAI-compatible chat endpoint for the app's built-in AI.
// The app sends its Lemon Squeezy license key as the bearer token; we check it with Lemon Squeezy,
// then forward to the Vercel AI Gateway with the server-side key. The gateway key never ships in the app.
//
// Env (Vercel project settings): AI_GATEWAY_API_KEY, LS_STORE_ID, LS_PRODUCT_ID (comma-separated ids allowed).

import { verify, hasPro } from './_lib.js';

const GATEWAY = 'https://ai-gateway.vercel.sh/v1/chat/completions';
const MODELS = new Set(['anthropic/claude-sonnet-5', 'anthropic/claude-opus-5.5', 'anthropic/claude-haiku-4.5', 'google/gemini-3.5-flash']);
const MAX_TOKENS = 16000;
const CACHE_MS = 10 * 60 * 1000;
const cache = new Map(); // license key → { ok, until } (per warm instance; Lemon Squeezy is the source of truth)

const fail = (res, status, message) => res.status(status).json({ error: { message } });

async function checkLicense(key) {
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.ok;
  const r = await fetch('https://api.lemonsqueezy.com/v1/licenses/validate', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ license_key: key }),
  });
  const d = await r.json().catch(() => ({}));
  const products = String(process.env.LS_PRODUCT_ID || '').split(',').map((s) => s.trim()).filter(Boolean);
  const ok = !!(d.valid && d.license_key?.status === 'active' &&
    String(d.meta?.store_id) === String(process.env.LS_STORE_ID) &&
    (!products.length || products.includes(String(d.meta?.product_id))));
  cache.set(key, { ok, until: Date.now() + CACHE_MS });
  return ok;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return fail(res, 405, 'Use POST.');
  if (!process.env.AI_GATEWAY_API_KEY || !process.env.LS_STORE_ID) return fail(res, 503, 'Skillerr Pro isn’t open yet.');
  const key = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!key) return fail(res, 401, 'Sign in with Google in Settings → Skillerr Pro (or paste a license key).');
  // Signed-in account (sk1.… session) with an active subscription, or a Lemon Squeezy license key.
  const session = key.startsWith('sk1.') ? verify(key) : null;
  const ok = session ? await hasPro(session.email).catch(() => false) : await checkLicense(key).catch(() => false);
  if (!ok) return fail(res, 401, session ? `No active Skillerr Pro subscription for ${session.email}. Get Pro at skillerr.com/#pricing.` : 'This Skillerr Pro license isn’t active. Check the key, or renew at skillerr.com/#pricing.');
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  if (!MODELS.has(body.model)) return fail(res, 400, `Pro supports: ${[...MODELS].join(', ')}.`);
  const upstream = await fetch(GATEWAY, {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.AI_GATEWAY_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, stream: false, max_tokens: Math.min(Number(body.max_tokens) || MAX_TOKENS, MAX_TOKENS) }),
  });
  const text = await upstream.text();
  res.status(upstream.status).setHeader('content-type', 'application/json').send(text);
}
