// Sign-in pop-ups keep window.opener: Google and Apple sign-in always open as a pop-up window, never a tab.
const test = require('node:test');
const assert = require('node:assert');
const { isSignInPopup, opensAsPopup } = require('../src/popups');

test('Google Identity Services and Apple sign-in open as pop-up windows', () => {
  const reddit = 'https://accounts.google.com/gsi/select?client_id=705819728788-b2c1kcs7tst3b7ghv7at0hkqmtc68ckl.apps.googleusercontent.com' +
    '&auto_select=true&ux_mode=popup&ui_mode=card&state=auth-flow-sso-buttons-google-da8c30f8&origin=https://www.reddit.com&hl=en';
  assert.strictEqual(isSignInPopup(reddit), true);
  assert.strictEqual(opensAsPopup(reddit, 'foreground-tab'), true, 'even without size features');
  for (const u of ['https://accounts.google.com/gsi/transform', 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x&redirect_uri=y',
    'https://accounts.google.com/o/oauth2/auth?client_id=x', 'https://accounts.google.com/signin/oauth?client_id=x',
    'https://accounts.google.com/v3/signin/identifier?continue=x', 'https://appleid.apple.com/auth/authorize?client_id=com.example']) {
    assert.strictEqual(isSignInPopup(u), true, u);
  }
});

test('other windows keep their usual behaviour', () => {
  assert.strictEqual(isSignInPopup('https://accounts.google.com.evil.example/gsi/select'), false);
  assert.strictEqual(isSignInPopup('https://evil.example/accounts.google.com/gsi/select'), false);
  assert.strictEqual(isSignInPopup('http://accounts.google.com/gsi/select'), false);
  assert.strictEqual(isSignInPopup('https://mail.google.com/mail/u/0/'), false);
  assert.strictEqual(isSignInPopup('https://www.reddit.com/r/test'), false);
  assert.strictEqual(isSignInPopup('not a url'), false);
  assert.strictEqual(opensAsPopup('https://www.example.com/pay', 'new-window'), true, 'a sized window.open is still a pop-up');
  assert.strictEqual(opensAsPopup('https://www.example.com/article', 'foreground-tab'), false);
});
