const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('sign-ins are written to disk after every navigation, without holding up quitting', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8').replace(/\r\n/g, '\n'); // Windows checks out CRLF
  assert.match(main, /cookies\.flushStore\(\)/);
  assert.match(main, /wc\.on\('did-navigate', flushCookiesSoon\)/);
  assert.match(main, /wc\.on\('did-redirect-navigation', flushCookiesSoon\)/);
  // The updater's restart relies on quitting straight away.
  assert.doesNotMatch(main, /before-quit', \(e\) => \{[^}]*preventDefault/);
});
