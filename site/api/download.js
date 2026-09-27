// Download gate: record the email, then hand back the installer URL.
// Storage: Neon Postgres (table `signups`, one row per download).
import { db } from './_db.js';

const REL = 'https://github.com/bharatdudeja13-cmd/skillerr-releases/releases/latest/download/';
const FILES = new Set(['Skillerr-0.1.0-arm64.dmg', 'Skillerr-0.1.0.dmg', 'Skillerr-Setup-0.1.0-x64.exe', 'Skillerr-Setup-0.1.0-arm64.exe',
  'Skillerr-0.1.0.AppImage', 'Skillerr-0.1.0-arm64.AppImage']);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  const email = String(body.email || '').trim().toLowerCase().slice(0, 200);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return res.status(400).json({ error: 'Please enter a valid email.' });
  const file = FILES.has(body.file) ? body.file : 'Skillerr-0.1.0-arm64.dmg';
  const rec = { email, file, updates: !!body.updates, ref: String(body.ref || '').slice(0, 60), at: new Date().toISOString(),
    country: req.headers['x-vercel-ip-country'] || '' };
  try {
    const d = db();
    if (d) {
      await d.ready;
      await d.sql`INSERT INTO signups (email, file, updates, ref, country) VALUES (${rec.email}, ${rec.file}, ${rec.updates}, ${rec.ref}, ${rec.country})`;
    } else console.log('SIGNUP', JSON.stringify(rec)); // no database configured: keep a trace in the logs
  } catch (err) {
    console.log('SIGNUP (storage failed)', err.message, JSON.stringify(rec));
  }
  res.status(200).json({ url: REL + file });
}
