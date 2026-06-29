// Tiny static-file server. Run with `node launch.js`.
// ES modules + importmap need HTTP; opening index.html via file:// won't work.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const PORT = 8771;
const ROOT = __dirname;
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

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);

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

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found: ' + rel);
      return;
    }

    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
});

server.on('error', (err) => {
  const url = `http://localhost:${PORT}`;
  if (err.code === 'EADDRINUSE') {
    console.log(`Port ${PORT} is already in use. Opening the existing server at ${url}`);
    openBrowser(url);
    return;
  }

  console.error(err);
  process.exit(1);
});

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`Apache canyon flight running at ${url}`);
  openBrowser(url);
});
