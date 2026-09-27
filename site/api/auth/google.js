// Start "Sign in with Google". ?app=1 means the Skillerr app asked, so we hand the session back to it.
import crypto from 'node:crypto';
import { sign, origin } from '../_lib.js';

export default function handler(req, res) {
  if (!process.env.GOOGLE_CLIENT_ID) return res.status(503).send('Sign-in isn’t set up yet.');
  const state = sign({ app: req.query.app === '1', n: crypto.randomBytes(8).toString('hex') }, 0.01); // ~15 minutes
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: `${origin(req)}/api/auth/callback/google`,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  res.redirect(302, `https://accounts.google.com/o/oauth2/v2/auth?${q}`);
}
