import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DashboardUser } from '../../shared/auth.ts';
import { maximumBrandingBodyBytes } from '../../shared/branding.ts';
import { BrandingError } from '../branding-store.ts';
import type { BrandingStore } from '../branding-store.ts';
import { allowMutation } from './security.ts';

export function routeBrandingIcon(req: IncomingMessage, res: ServerResponse, store: BrandingStore, username: string): boolean {
  if (req.url?.split('?')[0] !== '/branding/icon') return false;
  if (!['GET', 'HEAD'].includes(req.method || '')) { res.writeHead(405).end(); return true; }
  const icon = store.icon(username);
  res.setHeader('Content-Type', icon.type);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Length', icon.data.length);
  res.end(req.method === 'HEAD' ? undefined : icon.data);
  return true;
}

async function readBranding(req: IncomingMessage): Promise<unknown> {
  if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
    req.resume();
    throw new BrandingError('Verstuur application/json.', 415);
  }
  return new Promise((resolve, reject) => {
    let size = 0;
    let failed = false;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      if (failed) return;
      size += chunk.length;
      if (size > maximumBrandingBodyBytes) {
        failed = true;
        chunks.length = 0;
        reject(new BrandingError('Het uploadverzoek is te groot. Kies een kleinere afbeelding.', 413));
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      if (failed) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new BrandingError('Ongeldige JSON.')); }
    });
    req.on('error', () => reject(new BrandingError('Upload onderbroken.')));
    req.on('aborted', () => reject(new BrandingError('Upload onderbroken.')));
  });
}

export async function routeBranding(req: IncomingMessage, res: ServerResponse, store: BrandingStore,
  user: DashboardUser, authorized: () => boolean = () => user.role === 'admin'): Promise<boolean> {
  if (req.url !== '/api/branding') return false;
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'GET') { res.end(JSON.stringify(store.snapshot())); return true; }
  if (user.role !== 'admin') {
    req.resume();
    res.writeHead(403).end(JSON.stringify({ error: 'Alleen beheerders mogen het dashboardicoon aanpassen.' }));
    return true;
  }
  if (!allowMutation(req, res)) return true;
  try { res.end(JSON.stringify(await store.save(await readBranding(req), authorized))); }
  catch (error) {
    const known = error instanceof BrandingError;
    const status = known ? error.status : 500;
    res.writeHead(status).end(JSON.stringify({ error: known ? error.message : 'Opslaan van het icoon mislukt.',
      ...(status === 409 ? { currentRevision: store.snapshot().revision } : {}) }));
  }
  return true;
}
