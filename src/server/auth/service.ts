import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DashboardUser } from '../../shared/auth.ts';
import type { DiscordConfig } from './config.ts';
import type { AccessStore } from './access-store.ts';
import type { DiscordProvider } from './discord.ts';
import { createDiscordProvider } from './discord.ts';
import { createSessionStore } from './sessions.ts';
import { cookie, setCookie } from './cookies.ts';
import { allowMutation } from '../http/security.ts';

export function createAuth(config: DiscordConfig, access: AccessStore, onLogout: () => void,
  provider: DiscordProvider = createDiscordProvider(config)) {
  const sessions = createSessionStore();
  const ready = (): boolean => !!(config.clientId && config.clientSecret && config.adminIds.length);
  function user(req: IncomingMessage): DashboardUser | undefined {
    const identity = sessions.get(cookie(req, 'fay_session'));
    if (!identity) return;
    const role = access.role(identity.id);
    return role ? { ...identity, role } : undefined;
  }
  function redirect(res: ServerResponse, location: string): void { res.writeHead(302, { Location: location }).end(); }
  async function route(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url || '/', new URL(config.redirectUri).origin);
    if (!['/auth/session', '/auth/login', '/auth/logout', '/auth/discord/callback'].includes(url.pathname)) return false;
    if (req.headers.host !== new URL(config.redirectUri).host) {
      if (req.method === 'GET') redirect(res, `${new URL(config.redirectUri).origin}/login`);
      else res.writeHead(403).end();
      return true;
    }
    if (url.pathname === '/auth/logout') {
      if (allowMutation(req, res)) {
        sessions.remove(cookie(req, 'fay_session'));
        setCookie(res, 'fay_session', '', 0);
        onLogout();
        res.writeHead(204).end();
      }
      return true;
    }
    if (req.method !== 'GET') { res.writeHead(405).end(); return true; }
    if (url.pathname === '/auth/session') {
      const current = user(req);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ configured: ready(), authenticated: !!current, user: current }));
      return true;
    }
    if (!ready()) { res.writeHead(503).end('Discord-login is nog niet volledig ingesteld. Vul DISCORD_CLIENT_SECRET en DISCORD_ADMIN_IDS lokaal in.'); return true; }
    if (url.pathname === '/auth/login') {
      if (user(req)) { redirect(res, '/'); return true; }
      try {
        const flow = sessions.begin();
        setCookie(res, 'fay_oauth', flow.browser, 600);
        const target = new URL('https://discord.com/oauth2/authorize');
        target.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirectUri,
          response_type: 'code', scope: 'identify', state: flow.state }).toString();
        redirect(res, target.href);
      } catch { res.writeHead(429).end('Te veel inlogpogingen. Probeer later opnieuw.'); }
      return true;
    }
    setCookie(res, 'fay_oauth', '', 0);
    const valid = sessions.consume(url.searchParams.get('state') || undefined, cookie(req, 'fay_oauth'));
    const code = url.searchParams.get('code');
    if (!valid || !code || code.length > 2048 || url.searchParams.has('error')) {
      redirect(res, '/login?error=state'); return true;
    }
    try {
      const identity = await provider.identify(code);
      if (!access.role(identity.id)) { redirect(res, '/login?error=denied'); return true; }
      sessions.remove(cookie(req, 'fay_session'));
      setCookie(res, 'fay_session', sessions.create(identity), 8 * 60 * 60);
      redirect(res, '/');
    } catch { redirect(res, '/login?error=discord'); }
    return true;
  }
  return { route, user, revalidate: () => sessions.prune(id => !!access.role(id)) };
}
