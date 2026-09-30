// Toolbar notices (pop-up blocked, passkeys, updates) give way before the Pilot button: they never push it off the window.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('toolbar notices shrink, with an ellipsis, and keep their full text as a tooltip', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'ui.css'), 'utf8');
  const chip = css.match(/^\.popup-chip \{[^}]*\}/m)[0];
  assert.match(chip, /flex: 0 1 auto; min-width: 0;/);
  assert.match(css, /\.popup-chip > span:not\(\.dot\) \{ min-width: 0; overflow: hidden; text-overflow: ellipsis; \}/);
  assert.match(css, /\.tb-right > :not\(\.popup-chip\):not\(\.tb-fill\):not\(\.shelf\) \{ flex-shrink: 0; \}/);
  const ui = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'ui.js'), 'utf8');
  assert.match(ui, /chip\.title = `\$\{text\}\. ` \+/, 'passkey notice: full text in the tooltip');
  assert.match(ui, /chip\.title = `\$\{host\} tried to open a pop-up window`/);
});
