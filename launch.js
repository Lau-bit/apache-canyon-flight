// Tiny static-file server. Run with `node launch.js`.
// ES modules + importmap need HTTP; opening index.html via file:// won't work.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const PORT = Number(process.env.PORT) || 8771;
const ROOT = __dirname;
// Loopback only. `listen(PORT)` with no host binds every interface, which published
// this folder to the LAN. The documented Quest/USB path uses `adb reverse`, so it
// arrives here as a loopback connection and is unaffected by this.
const HOST = '127.0.0.1';
// The trailing separator is the whole point: `startsWith(ROOT)` alone is satisfied by
// any sibling directory whose name merely EXTENDS this one's.
const ROOT_PREFIX = ROOT + path.sep;
// Presets are persisted to disk here so they survive browser localStorage wipes,
// different browser instances, and dev restarts — only removed when overwritten.
const PRESETS_FILE = path.join(ROOT, '.presets.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

function openBrowser(url) {
  const opener = process.platform === 'win32'
    ? `start "" "${url}"`
    : process.platform === 'darwin'
      ? `open "${url}"`
      : `xdg-open "${url}"`;
  exec(opener);
}

// Error replies: a fixed body, never the requested path echoed back, and always with
// an explicit type + nosniff so a reflected byte can never be sniffed as markup.
function fail(res, code, msg) {
  res.writeHead(code, {
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(msg);
}

const server = http.createServer((req, res) => {
  const rawPath = req.url.split('?')[0];
  let url;
  try {
    // A lone `%` makes decodeURIComponent throw, and an uncaught throw in this
    // handler takes the entire server process down.
    url = decodeURIComponent(rawPath);
  } catch {
    fail(res, 400, 'Bad request');
    return;
  }

  // ---- Presets persistence API ----
  if (url === '/api/presets') {
    if (req.method === 'GET') {
      fs.readFile(PRESETS_FILE, 'utf8', (err, data) => {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(err ? '{}' : data);
      });
      return;
    }
    if (req.method === 'PUT' || req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 1e6) req.destroy(); // guard against runaway payloads
      });
      req.on('end', () => {
        try { JSON.parse(body); } catch { res.writeHead(400); res.end('Bad JSON'); return; }
        fs.writeFile(PRESETS_FILE, body, (err) => {
          if (err) { res.writeHead(500); res.end('Write failed'); return; }
          res.writeHead(200); res.end('OK');
        });
      });
      return;
    }
    res.writeHead(405);
    res.end('Method not allowed');
    return;
  }

  const rel = url === '/' ? '/index.html' : url;
  const filePath = path.normalize(path.join(ROOT, rel));

  if (filePath !== ROOT && !filePath.startsWith(ROOT_PREFIX)) { fail(res, 403, 'Forbidden'); return; }

  fs.readFile(filePath, (err, data) => {
    if (err) { fail(res, 404, 'Not found'); return; }

    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
});

server.on('error', (err) => {
  const url = `http://localhost:${PORT}`;
  if (err.code === 'EADDRINUSE') {
    console.log(`Port ${PORT} is already in use. Opening the existing server at ${url}`);
    if (!process.env.NO_OPEN) openBrowser(url);
    return;
  }

  console.error(err);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`Apache canyon flight running at ${url}`);
  if (!process.env.NO_OPEN) openBrowser(url);
});
