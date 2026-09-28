// Entry point. Turns on V8's on-disk code cache before loading the app, so every start after the first skips
// compiling main.js (about 20 ms off each start; see docs/benchmarks.md → Startup).
const { enableCompileCache } = require('node:module');
if (enableCompileCache) {
  try {
    enableCompileCache();
  } catch {}
}
require('./main.js');
