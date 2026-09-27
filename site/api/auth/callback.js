// Google sends people back here. We verify who they are, then either open the Skillerr app
// (skillerr://auth?token=…) or set a cookie for the website.
import { sign, verify, origin, hasPro } from '../_lib.js';

const page = (title, body) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0c0c10;color:#ededf2;font:16px/1.5 -apple-system,system-ui,sans-serif;text-align:center;padding:24px}
a.btn{display:inline-block;margin-top:14px;padding:12px 22px;border-radius:12px;background:#8b6cff;color:#fff;text-decoration:none;font-weight:600}
code{display:block;margin-top:14px;padding:10px;border-radius:8px;background:#1d1d25;word-break:break-all;font-size:12px;color:#a4a4b2}</style><div>${body}</div>`;

export default async function handler(req, res) {
  const state = verify(req.query.state);
  if (!state || !req.query.code) return res.status(400).send(page('Sign-in failed', '<h2>That sign-in link expired.</h2><p>Please try again from Skillerr.</p>'));
  const tok = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: req.query.code, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${origin(req)}/api/auth/callback/google`, grant_type: 'authorization_code',
    }),
  }).then((r) => r.json());
  // Google checks the ID token's signature and audience for us here.
  const info = tok.id_token ? await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${tok.id_token}`).then((r) => r.json()) : {};
  if (info.aud !== process.env.GOOGLE_CLIENT_ID || info.email_verified !== 'true') {
    return res.status(401).send(page('Sign-in failed', '<h2>Google didn’t confirm that account.</h2><p>Please try again.</p>'));
  }
  const session = sign({ email: info.email, name: info.name || '', picture: info.picture || '' });
  const pro = await hasPro(info.email).catch(() => false);
  if (state.app) {
    const link = `skillerr://auth?token=${encodeURIComponent(session)}`;
    return res.send(page('Signed in to Skillerr', `<h2>Signed in as ${info.email}</h2>
      <p>${pro ? 'Skillerr Pro is active on this account.' : 'No Skillerr Pro subscription on this account yet.'}</p>
      <a class="btn" href="${link}">Open Skillerr</a>
      <p style="color:#6d6d7c;font-size:13px;margin-top:22px">If Skillerr doesn’t open, paste this into Settings → Skillerr Pro:</p><code>${session}</code>
      <script>location.href=${JSON.stringify(link)}</script>`));
  }
  res.setHeader('set-cookie', `sk_session=${session}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${90 * 86400}`);
  res.redirect(302, '/#pricing');
}
