import type { IncomingMessage, ServerResponse } from 'node:http';

export function cookie(req: IncomingMessage, name: string): string | undefined {
  const matches = (req.headers.cookie || '').split(';').map(value => value.trim()).filter(value => value.startsWith(`${name}=`));
  return matches.length === 1 ? matches[0].slice(name.length + 1) : undefined;
}

export function setCookie(res: ServerResponse, name: string, value: string, maxAge: number, secure = false): void {
  const path = name === 'fay_oauth' ? '/auth/discord/callback' : '/';
  const existing = res.getHeader('Set-Cookie');
  const values = Array.isArray(existing) ? existing.map(String) : existing ? [String(existing)] : [];
  res.setHeader('Set-Cookie', [...values, `${name}=${value}; Path=${path}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`]);
}
