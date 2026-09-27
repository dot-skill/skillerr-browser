// Who is signed in (cookie for the website, bearer token for the app), and do they have Pro?
import { verify, hasPro } from './_lib.js';

export default async function handler(req, res) {
  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const cookie = (req.headers.cookie || '').match(/(?:^|;\s*)sk_session=([^;]+)/)?.[1];
  const s = verify(bearer || cookie);
  if (!s) return res.status(200).json({ signedIn: false });
  res.status(200).json({ signedIn: true, email: s.email, name: s.name, pro: await hasPro(s.email).catch(() => false),
    checkout: process.env.LS_CHECKOUT_URL ? `${process.env.LS_CHECKOUT_URL}?checkout[email]=${encodeURIComponent(s.email)}` : null });
}
