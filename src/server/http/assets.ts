import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';

const root = new URL('../../../', import.meta.url);
const assets = new Map<string, [URL, string]>([
  ['/', [new URL('public/index.html', root), 'text/html; charset=utf-8']],
  ['/login', [new URL('public/login.html', root), 'text/html; charset=utf-8']],
  ['/styles.css', [new URL('public/styles.css', root), 'text/css; charset=utf-8']]
]);
for (const name of ['app', 'connection', 'dom', 'filters', 'model', 'pages', 'render', 'demo', 'commands', 'auth', 'login', 'access']) {
  assets.set(`/assets/${name}.js`, [new URL(`dist/browser/client/${name}.js`, root), 'text/javascript; charset=utf-8']);
}

export async function serveAsset(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const asset = assets.get(req.url?.startsWith('/login?') ? '/login' : req.url || '');
  if (!asset || req.method !== 'GET') { res.writeHead(404).end(); return; }
  try {
    const content = await readFile(asset[0]);
    res.setHeader('Content-Type', asset[1]);
    res.end(content);
  } catch { res.writeHead(500).end('Bestand niet beschikbaar. Voer npm run build uit.'); }
}
