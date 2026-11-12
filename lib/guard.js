'use strict';

// The server listens on 127.0.0.1 only, but a web page open in a browser on this computer could still reach it. Two
// rules keep such a page out:
//   - the Host header must be this computer's (a page that renamed its own domain to 127.0.0.1 - DNS rebinding - still
//     sends its own name);
//   - a write (anything but GET / HEAD) must be JSON: a page of another origin cannot send that without asking first,
//     and this server never answers the asking.

const LOCAL_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;

function guard(req, res, next) {
  if (!LOCAL_HOST.test(String(req.headers.host || ''))) {
    return res.status(403).json({ error: 'this server answers this computer only' });
  }
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.path.startsWith('/api/')) {
    const type = String(req.headers['content-type'] || '');
    if (!/^application\/json\b/i.test(type)) return res.status(415).json({ error: 'send JSON' });
  }
  next();
}

module.exports = { guard };
