import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';

const root = new URL('../../../', import.meta.url);
const assets = new Map<string, [URL, string]>([
  ['/shared/username-color.js', [new URL('dist/browser/shared/username-color.js', root), 'text/javascript; charset=utf-8']],
  ['/shared/command-templates.js', [new URL('dist/browser/shared/command-templates.js', root), 'text/javascript; charset=utf-8']],
  ['/shared/command-policy.js', [new URL('dist/browser/shared/command-policy.js', root), 'text/javascript; charset=utf-8']],
  ['/shared/moderation-policy.js', [new URL('dist/browser/shared/moderation-policy.js', root), 'text/javascript; charset=utf-8']],
  ['/shared/filter-settings.js', [new URL('dist/browser/shared/filter-settings.js', root), 'text/javascript; charset=utf-8']],
  ['/shared/branding.js', [new URL('dist/browser/shared/branding.js', root), 'text/javascript; charset=utf-8']],
  ['/shared/user-identity.js', [new URL('dist/browser/shared/user-identity.js', root), 'text/javascript; charset=utf-8']],
  ['/', [new URL('public/index.html', root), 'text/html; charset=utf-8']],
  ['/login', [new URL('public/login.html', root), 'text/html; charset=utf-8']],
  ['/styles.css', [new URL('public/styles.css', root), 'text/css; charset=utf-8']],
  ['/theme.css', [new URL('public/theme.css', root), 'text/css; charset=utf-8']],
  ['/theme.js', [new URL('public/theme.js', root), 'text/javascript; charset=utf-8']],
  ['/workspace.css', [new URL('public/workspace.css', root), 'text/css; charset=utf-8']],
  ['/moderation.css', [new URL('public/moderation.css', root), 'text/css; charset=utf-8']],
  ['/moderation-feedback.css', [new URL('public/moderation-feedback.css', root), 'text/css; charset=utf-8']],
  ['/access.css', [new URL('public/access.css', root), 'text/css; charset=utf-8']],
  ['/command-status.css', [new URL('public/command-status.css', root), 'text/css; charset=utf-8']],
  ['/filters.css', [new URL('public/filters.css', root), 'text/css; charset=utf-8']],
  ['/activity.css', [new URL('public/activity.css', root), 'text/css; charset=utf-8']],
  ['/branding.css', [new URL('public/branding.css', root), 'text/css; charset=utf-8']],
  ['/layout.css', [new URL('public/layout.css', root), 'text/css; charset=utf-8']],
  ['/density.css', [new URL('public/density.css', root), 'text/css; charset=utf-8']]
]);
for (const name of ['app', 'connection', 'dom', 'filters', 'model', 'pages', 'render', 'demo', 'commands', 'auth', 'login', 'access', 'capabilities', 'moderation', 'message-actions', 'preferences', 'unsaved','diagnostics','credentials','command-status','filter-editor','live-activity','branding','layout','workspace-layout','workspace-settings','moderation-feedback','user-identity','moderation-identity']) {
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
