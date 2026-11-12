'use strict';

// The app's server: Express on 127.0.0.1 only. Under Electron, desktop/main.js calls start() on the owner's library;
// started alone (`npm run server`) it works on dev-library/ at port 3310 (PORT overrides).

const http = require('http');
const express = require('express');
const { PUBLIC_DIR, LIBRARY_DIR, FAKE, ensureLibrary } = require('./lib/config');
const { guard } = require('./lib/guard');

const HOST = '127.0.0.1';

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(guard);
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', require('./routes/app'));
  app.use('/api', (req, res) => res.status(404).json({ error: 'no such route' }));
  app.use(express.static(PUBLIC_DIR, { index: 'index.html' }));
  // Errors in words, as JSON: a 400 says what was wrong; anything else is logged and said shortly.
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error('[server]', req.method, req.originalUrl, err);
    res.status(status).json({ error: status >= 500 ? 'something went wrong on the server' : err.message });
  });
  return app;
}

function _listen(app, port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.once('error', reject);
    server.listen(port, HOST, () => {
      server.removeListener('error', reject);
      resolve(server);
    });
  });
}

/**
 * Starts the server. `tryNext` - when the port is taken, the next ones are tried (up to 20).
 * Resolves { server, port, url }.
 */
async function start({ port = 3310, tryNext = false } = {}) {
  ensureLibrary();
  const app = createApp();
  for (let i = 0; i < (tryNext ? 20 : 1); i++) {
    try {
      const server = await _listen(app, port + i);
      const p = server.address().port;
      console.log('[boot] library: ' + LIBRARY_DIR + (FAKE ? ' (FAKE - nothing paid is asked)' : ''));
      console.log('[boot] listening on http://' + HOST + ':' + p);
      return { server, port: p, url: 'http://' + HOST + ':' + p + '/' };
    } catch (e) {
      if (e.code !== 'EADDRINUSE' || !tryNext) throw e;
    }
  }
  throw new Error('no free port from ' + port + ' to ' + (port + 19));
}

module.exports = { start, createApp };

if (require.main === module) {
  start({ port: +process.env.PORT || 3310 }).catch(e => {
    console.error('[boot] could not start: ' + e.message);
    process.exit(1);
  });
}
