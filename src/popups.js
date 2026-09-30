// Which windows a page opens stay real pop-up windows instead of tabs. The page and a sign-in pop-up talk through
// window.opener: Google Identity Services with ux_mode=popup posts the credential back to it, and Sign in with Apple
// does the same, then the pop-up closes itself. A tab has no opener, so the sign-in finishes in a dead end (a blank
// accounts.google.com/gsi/select, or gsi/transform) and the site never hears of it.

// Sign-in pages that always get a pop-up, however the page opened them (window.open with or without size features).
const SIGN_IN = [
  [/^accounts\.google\.com$/, /^\/(gsi\/|o\/oauth2\/|signin\/|ServiceLogin|AccountChooser|v3\/signin\/)/],
  [/^appleid\.apple\.com$/, /^\/auth\/(authorize|oauth2)/],
];

function isSignInPopup(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return u.protocol === 'https:' && SIGN_IN.some(([host, route]) => host.test(u.hostname) && route.test(u.pathname));
}

// A window the page asked for as a pop-up (window.open with size features), or a sign-in page in any disposition.
const opensAsPopup = (url, disposition) => disposition === 'new-window' || isSignInPopup(url);

module.exports = { isSignInPopup, opensAsPopup };
