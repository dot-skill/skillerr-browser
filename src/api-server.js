// Local control API on 127.0.0.1. The MCP bridge (mcp/bridge.js) talks to this.
// Protected by a random bearer token written to ~/.skillerr/browser/session.json, and requests
// carrying an Origin header are refused so web pages can't drive the browser.
const http = require('http');
const crypto = require('crypto');

const PREFERRED_PORT = 47821;

function startApiServer({ tools, onHello, onCall, onPreview, onInbox }) {
  const token = crypto.randomBytes(24).toString('hex');

  const server = http.createServer(async (req, res) => {
    const send = (code, body) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.headers.origin) return send(403, { error: 'Browser-origin requests are not allowed' });
    if (req.headers.authorization !== `Bearer ${token}`) return send(401, { error: 'Bad token' });

    let body = {};
    if (req.method === 'POST') {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        return send(400, { error: 'Invalid JSON' });
      }
    }

    try {
      if (req.method === 'GET' && req.url === '/tools') return send(200, { tools });
      if (req.method === 'POST' && req.url === '/hello') {
        onHello(body.client || 'Unknown AI', { model: body.model });
        return send(200, { ok: true });
      }
      // Live preview for AI apps: frames and Pause / Take over. Not an AI action, so not logged or gated.
      if (req.method === 'POST' && req.url === '/preview' && onPreview) {
        return send(200, await onPreview(body.client || 'Unknown AI', body.op, body.args || {}));
      }
      // Messages from the Pilot panel, for `node mcp/bridge.js --watch-inbox`. Read only: messages are made in the panel.
      if (req.method === 'POST' && req.url === '/inbox' && onInbox) {
        return send(200, await onInbox(body.client || '*', Number(body.wait_s) || 0));
      }
      if (req.method === 'POST' && req.url === '/call') {
        const result = await onCall(body.client || 'Unknown AI', body.name, body.args || {}, { model: body.model });
        return send(200, result);
      }
      send(404, { error: 'Not found' });
    } catch (err) {
      send(200, { error: err.message || String(err) });
    }
  });

  return new Promise((resolve) => {
    server.once('error', () => server.listen(0, '127.0.0.1')); // preferred port taken → random port
    server.once('listening', () => resolve({ server, port: server.address().port, token }));
    server.listen(PREFERRED_PORT, '127.0.0.1');
  });
}

module.exports = { startApiServer };
