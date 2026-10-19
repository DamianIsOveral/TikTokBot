import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppConfig } from '../config.ts';
import {avatarCdnDomains} from '../../shared/user-identity.ts';

const requestOrigins = new WeakMap<IncomingMessage, string>();

export function secureRequest(req: IncomingMessage, res: ServerResponse, config: Pick<AppConfig, 'port' | 'publicOrigin'>): boolean {
  const images=avatarCdnDomains.flatMap(domain=>[`https://${domain}`,`https://*.${domain}`]).join(' ');
  res.setHeader('Content-Security-Policy', `default-src 'self'; img-src 'self' ${images}; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cache-Control', 'no-store');
  const localHosts = ['127.0.0.1', 'localhost', '[::1]'].map(host => `${host}:${config.port}`);
  const path = req.url?.split('?')[0];
  const localHealth = req.method === 'GET' && req.url === '/health' && localHosts.includes(req.headers.host || '');
  const hosts = config.publicOrigin ? [new URL(config.publicOrigin).host] : localHosts;
  const callback = req.method === 'GET' && path === '/auth/discord/callback';
  const navigation = req.method === 'GET' && ['/', '/login'].includes(path || '')
    && req.headers['sec-fetch-mode'] === 'navigate' && req.headers['sec-fetch-dest'] === 'document';
  if ((!hosts.includes(req.headers.host || '') && !localHealth)
    || (req.headers['sec-fetch-site'] === 'cross-site' && !callback && !navigation)) {
    res.writeHead(403).end();
    return false;
  }
  // Pin the browser origin from configuration, never from forwarded proxy headers.
  requestOrigins.set(req, config.publicOrigin || `http://${req.headers.host}`);
  if (config.publicOrigin && !localHealth) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  return true;
}

export function allowMutation(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method !== 'POST') { res.writeHead(405).end(); return false; }
  if (!requestOrigins.has(req) || req.headers.origin !== requestOrigins.get(req) || req.headers['x-requested-with'] !== 'faynominaal') {
    res.writeHead(403).end(); return false;
  }
  return true;
}
