// Shared by the API routes (files starting with "_" aren't routes on Vercel).
// Sessions are small signed tokens (HMAC-SHA256 with SESSION_SECRET); no database.
import crypto from 'node:crypto';

const b64u = (b) => Buffer.from(b).toString('base64url');
const SECRET = () => {
  if (!process.env.SESSION_SECRET) throw new Error('SESSION_SECRET is not set');
  return process.env.SESSION_SECRET;
};

export function sign(payload, days = 90) {
  const body = b64u(JSON.stringify({ ...payload, exp: Date.now() + days * 864e5 }));
  const mac = crypto.createHmac('sha256', SECRET()).update(body).digest('base64url');
  return `sk1.${body}.${mac}`;
}

export function verify(token) {
  const [v, body, mac] = String(token || '').split('.');
  if (v !== 'sk1' || !body || !mac) return null;
  const want = crypto.createHmac('sha256', SECRET()).update(body).digest('base64url');
  if (mac.length !== want.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want))) return null;
  const data = JSON.parse(Buffer.from(body, 'base64url').toString());
  return data.exp > Date.now() ? data : null;
}

export const origin = (req) => `https://${req.headers['x-forwarded-host'] || req.headers.host}`;

// Is there an active Skillerr Pro subscription for this email? (Lemon Squeezy is the source of truth.)
const proCache = new Map();
export async function hasPro(email) {
  if (!email || !process.env.LS_API_KEY || !process.env.LS_STORE_ID) return false;
  const hit = proCache.get(email);
  if (hit && hit.until > Date.now()) return hit.ok;
  const q = new URLSearchParams({ 'filter[store_id]': process.env.LS_STORE_ID, 'filter[user_email]': email });
  const r = await fetch(`https://api.lemonsqueezy.com/v1/subscriptions?${q}`, {
    headers: { accept: 'application/vnd.api+json', authorization: `Bearer ${process.env.LS_API_KEY}` },
  });
  const d = await r.json().catch(() => ({}));
  const products = String(process.env.LS_PRODUCT_ID || '').split(',').map((s) => s.trim()).filter(Boolean);
  const ok = (d.data || []).some((s) => ['active', 'on_trial', 'past_due'].includes(s.attributes?.status) &&
    (!products.length || products.includes(String(s.attributes?.product_id))));
  proCache.set(email, { ok, until: Date.now() + 10 * 60 * 1000 });
  return ok;
}
