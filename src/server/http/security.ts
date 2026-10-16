import type { IncomingMessage, ServerResponse } from 'node:http';

export function secureRequest(req: IncomingMessage, res: ServerResponse, port: number): boolean {
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cache-Control', 'no-store');
  const hosts = ['127.0.0.1', 'localhost', '[::1]'].map(host => `${host}:${port}`);
  if (!hosts.includes(req.headers.host || '') || req.headers['sec-fetch-site'] === 'cross-site') {
    res.writeHead(403).end();
    return false;
  }
  return true;
}

export function allowMutation(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method !== 'POST') { res.writeHead(405).end(); return false; }
  if (req.headers.origin !== `http://${req.headers.host}` || req.headers['x-requested-with'] !== 'faynominaal') {
    res.writeHead(403).end(); return false;
  }
  return true;
}
