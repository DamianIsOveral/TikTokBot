import type { AppConfig } from '../src/server/config.ts';
import { createApp } from '../src/server/app.ts';
import { createAccessStore } from '../src/server/auth/access-store.ts';
import type { ConnectorLoader } from '../src/server/types.ts';
import type { CommandStore } from '../src/server/command-store.ts';
import type { AccessStore } from '../src/server/auth/access-store.ts';
import type { AccountReader } from '../src/server/euler-access.ts';

export const ADMIN = '111111111111111111';
export const MEMBER = '222222222222222222';
export const DENIED = '333333333333333333';

export function createTestApp(config: AppConfig, connector?: ConnectorLoader, commands?: CommandStore,
  access: AccessStore = createAccessStore([ADMIN]),
  accountReader: AccountReader = async () => ({ account: { scopes: [13], expires_at: null } })) {
  config.discord.clientId = '999999999999999999';
  config.discord.clientSecret = 'offline-test-secret';
  config.discord.adminIds = [ADMIN];
  config.options.signApiKey ||= 'offline-key';
  return createApp(config, connector, commands, access, {
    identify: async code => ({ id: code, name: 'Offline testgebruiker' })
  }, accountReader);
}

export async function beginLogin(base: string) {
  const response = await fetch(base + '/auth/login', { redirect: 'manual' });
  const location = response.headers.get('location');
  if (response.status !== 302 || !location) throw new Error('Login starten mislukt.');
  const cookie = response.headers.getSetCookie().find(value => value.startsWith('fay_oauth='))!.split(';')[0];
  return { url: new URL(location), cookie };
}

export async function signIn(config: AppConfig, id = ADMIN): Promise<string> {
  const base = `http://127.0.0.1:${config.port}`;
  config.discord.redirectUri = base + '/auth/discord/callback';
  const flow = await beginLogin(base);
  const callback = new URL(config.discord.redirectUri);
  callback.search = new URLSearchParams({ state: flow.url.searchParams.get('state')!, code: id }).toString();
  const response = await fetch(callback, { redirect: 'manual', headers: { Cookie: flow.cookie, 'Sec-Fetch-Site': 'cross-site' } });
  const cookie = response.headers.getSetCookie().find(value => value.startsWith('fay_session='));
  if (response.status !== 302 || !cookie) throw new Error('Testlogin mislukt.');
  return cookie.split(';')[0];
}

export function authenticatedFetch(cookie: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set('Cookie', cookie);
    return globalThis.fetch(input, { ...init, headers });
  };
}
