import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const port = Number(process.env.PUBLIC_SERVER_PORT || 8080);
const backendOrigin = new URL(process.env.AI_BACKEND_PROXY_URL || 'http://127.0.0.1:8012');

const apiPrefixes = [
  '/adherence',
  '/admin',
  '/chat',
  '/chat-lite',
  '/chat-with-attachments',
  '/coach',
  '/coach-notifications',
  '/debug',
  '/health',
  '/integrations',
  '/plans',
  '/reports',
  '/static',
  '/tts',
  '/voice-chat',
];

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.wav': 'audio/wav',
  '.webp': 'image/webp',
};

function isApiRequest(urlPath) {
  if (urlPath === '/coach' || urlPath === '/admin' || urlPath === '/reports') {
    return false;
  }
  return apiPrefixes.some((prefix) => urlPath === prefix || urlPath.startsWith(`${prefix}/`));
}

function send(res, statusCode, body, headers = {}) {
  res.writeHead(statusCode, headers);
  res.end(body);
}

function serveFile(req, res) {
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const decodedPath = decodeURIComponent(requestUrl.pathname);
  const cleanPath = decodedPath.replace(/^\/+/, '');
  const candidate = path.resolve(distDir, cleanPath);
  const indexPath = path.join(distDir, 'index.html');

  let filePath = candidate.startsWith(distDir) ? candidate : indexPath;
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = indexPath;
  }

  const ext = path.extname(filePath).toLowerCase();
  const headers = {
    'Content-Type': contentTypes[ext] || 'application/octet-stream',
  };
  if (filePath.includes(`${path.sep}assets${path.sep}`)) {
    headers['Cache-Control'] = 'public, max-age=31536000, immutable';
  } else {
    headers['Cache-Control'] = 'no-cache';
  }

  fs.createReadStream(filePath)
    .on('error', () => send(res, 500, 'Failed to read file'))
    .pipe(res.writeHead(200, headers));
}

function proxyRequest(req, res) {
  const targetUrl = new URL(req.url || '/', backendOrigin);
  const headers = { ...req.headers, host: backendOrigin.host };
  delete headers.connection;

  const proxy = http.request(
    {
      protocol: backendOrigin.protocol,
      hostname: backendOrigin.hostname,
      port: backendOrigin.port,
      method: req.method,
      path: `${targetUrl.pathname}${targetUrl.search}`,
      headers,
    },
    (backendRes) => {
      res.writeHead(backendRes.statusCode || 502, backendRes.headers);
      backendRes.pipe(res);
    }
  );

  proxy.on('error', (error) => {
    send(res, 502, JSON.stringify({ detail: `Backend proxy failed: ${error.message}` }), {
      'Content-Type': 'application/json; charset=utf-8',
    });
  });

  req.pipe(proxy);
}

http
  .createServer((req, res) => {
    const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (isApiRequest(requestUrl.pathname)) {
      proxyRequest(req, res);
      return;
    }
    serveFile(req, res);
  })
  .listen(port, '127.0.0.1', () => {
    console.log(`FitCoach public server listening on http://127.0.0.1:${port}`);
    console.log(`Proxying backend API to ${backendOrigin.origin}`);
  });
