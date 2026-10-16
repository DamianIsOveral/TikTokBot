import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { readConfig } from './config.js';
import { createLive } from './live.js';
import { createSession } from './session.js';

export function createApp(config, loadConnector) {
  const clients = new Set();
  function broadcast(event) {
    const frame = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of clients) {
      if (!client.write(frame)) client.destroy();
    }
  }
  const session = createSession(broadcast);
  const live = createLive(config, session.receive, loadConnector);
  const files = new Map([
    ['/', ['index.html', 'text/html; charset=utf-8']],
    ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
    ['/live-client.js', ['live-client.js', 'text/javascript; charset=utf-8']],
    ['/styles.css', ['styles.css', 'text/css; charset=utf-8']]
  ]);
  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cache-Control', 'no-store');
    const hosts = ['127.0.0.1', 'localhost', '[::1]'].map(host => `${host}:${config.port}`);
    if (!hosts.includes(req.headers.host)) { res.writeHead(403).end(); return; }
    if (req.headers['sec-fetch-site'] === 'cross-site') { res.writeHead(403).end(); return; }
    const path = req.url;
    if (path === '/health' && req.method === 'GET') {
      res.setHeader('Content-Type', 'application/json');
      res.end('{"ok":true,"app":"faynominaal-live"}'); return;
    }
    if (path === '/api/config' && req.method === 'GET') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ username: config.username, botEnabled: config.botEnabled })); return;
    }
    if (path === '/api/snapshot' && req.method === 'GET') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(session.snapshot())); return;
    }
    if (path === '/api/events' && req.method === 'GET') {
      if (clients.size >= 10) { res.writeHead(503).end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'X-Accel-Buffering': 'no' });
      res.write(`data: ${JSON.stringify(session.snapshot())}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res)); return;
    }
    if (path === '/api/connect' || path === '/api/stop') {
      if (req.method !== 'POST') { res.writeHead(405).end(); return; }
      const origin = `http://${req.headers.host}`;
      if (req.headers.origin !== origin || req.headers['x-requested-with'] !== 'faynominaal') {
        res.writeHead(403).end(); return;
      }
      if (path === '/api/connect') void live.connect();
      else void live.stop();
      res.writeHead(202).end(); return;
    }
    const asset = files.get(path);
    if (!asset || req.method !== 'GET') { res.writeHead(404).end(); return; }
    try {
      const content = await readFile(new URL(`../public/${asset[0]}`, import.meta.url));
      res.setHeader('Content-Type', asset[1]); res.end(content);
    } catch { res.writeHead(500).end('Bestand niet beschikbaar.'); }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.maxConnections = 50;
  const heartbeat = setInterval(() => {
    for (const client of clients) if (!client.write(': heartbeat\n\n')) client.destroy();
  }, 25_000);
  heartbeat.unref();
  async function close() {
    clearInterval(heartbeat);
    for (const client of clients) client.end();
    await live.stop();
    await new Promise(resolve => server.close(resolve));
  }
  return { server, close };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const config = readConfig();
  const app = createApp(config);
  app.server.listen(config.port, config.host, () => {
    console.log(`Dashboard: http://${config.host === '::1' ? '[::1]' : config.host}:${config.port}`);
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    const deadline = setTimeout(() => process.exit(1), 5000);
    deadline.unref();
    void app.close().then(() => clearTimeout(deadline));
  });
}
