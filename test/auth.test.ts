import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import type { TestContext } from 'node:test';
import http from 'node:http';
import { readConfig } from '../src/server/config.ts';
import { createApp } from '../src/server/app.ts';
import { createAccessStore, loadAccessStore } from '../src/server/auth/access-store.ts';
import { createDiscordProvider } from '../src/server/auth/discord.ts';
import { createSessionStore } from '../src/server/auth/sessions.ts';
import { ADMIN, MEMBER, DENIED, createTestApp, beginLogin, signIn, authenticatedFetch } from './auth-fixture.ts';

async function fixture(t: TestContext, configured = true) {
  const config = readConfig({});
  const access = createAccessStore([ADMIN], undefined, { revision: 0, users: [{ id: MEMBER, role: 'member' }] });
  const app = configured ? createTestApp(config, undefined, undefined, access) : createApp(config);
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  config.port = (app.server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${config.port}`;
  config.discord.redirectUri = base + '/auth/discord/callback';
  t.after(() => app.close());
  return { config, access, base };
}

test('dashboard en alle API-data zijn zonder login afgeschermd, ook zonder OAuth-secret', async t => {
  const { base } = await fixture(t, false);
  const root = await fetch(base, { redirect: 'manual' });
  assert.equal(root.status, 302);
  assert.equal(root.headers.get('location'), '/login');
  assert.equal((await fetch(base + '/login')).status, 200);
  for (const [path,type] of [['/theme.js','text/javascript'],['/theme.css','text/css']]) {
    const response = await fetch(base + path);
    assert.equal(response.status,200);
    assert.match(response.headers.get('content-type') || '',new RegExp(type));
  }
  const login = await (await fetch(base + '/login')).text();
  assert.ok(login.indexOf('src="/theme.js"') < login.indexOf('rel="stylesheet"'));
  assert.match(login,/data-theme-mode/);
  assert.equal((await fetch(base + '/health')).status, 200);
  for (const path of ['/api/config', '/api/snapshot', '/api/events', '/api/commands', '/api/access']) {
    assert.equal((await fetch(base + path)).status, 401, path);
  }
  assert.equal((await fetch(base + '/api/connect', { method: 'POST' })).status, 401);
  assert.equal((await fetch(base + '/api/stop', { method: 'POST' })).status, 401);
  const session = await (await fetch(base + '/auth/session')).json();
  assert.deepEqual(session, { configured: false, authenticated: false });
  assert.equal((await fetch(base + '/auth/login')).status, 503);
});

test('OAuth bindt eenmalige state aan de browser, gebruikt identify en weigert onbekende IDs', async t => {
  const { base, config } = await fixture(t);
  const flow = await beginLogin(base);
  assert.equal(flow.url.origin, 'https://discord.com');
  assert.equal(flow.url.searchParams.get('scope'), 'identify');
  assert.equal(flow.url.searchParams.get('redirect_uri'), config.discord.redirectUri);
  assert.ok(!flow.url.href.includes(config.discord.clientSecret));
  const callback = `${config.discord.redirectUri}?code=${ADMIN}&state=${flow.url.searchParams.get('state')}`;
  const noCookie = await fetch(callback, { redirect: 'manual' });
  assert.equal(noCookie.headers.get('location'), '/login?error=state');
  const correct = await fetch(callback, { redirect: 'manual', headers: { Cookie: flow.cookie, 'Sec-Fetch-Site': 'cross-site' } });
  assert.equal(correct.headers.get('location'), '/');
  const sessionCookie = correct.headers.getSetCookie().find(value => value.startsWith('fay_session='))!;
  assert.match(sessionCookie, /HttpOnly/);
  assert.match(sessionCookie, /SameSite=Lax/);
  assert.match(sessionCookie, /Path=\//);
  const navigationHeaders = { Cookie: sessionCookie.split(';')[0], 'Sec-Fetch-Site': 'cross-site',
    'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' };
  const navigationStatus = (headers: Record<string, string>) => new Promise<number>((resolve, reject) => {
    http.get(base, { headers }, response => { response.resume(); resolve(response.statusCode!); }).on('error', reject);
  });
  assert.equal(await navigationStatus(navigationHeaders), 200);
  assert.equal(await navigationStatus({ ...navigationHeaders, 'Sec-Fetch-Dest': 'iframe' }), 403);
  assert.equal((await fetch(base + '/api/config', { headers: navigationHeaders })).status, 403);
  const replay = await fetch(callback, { redirect: 'manual', headers: { Cookie: flow.cookie } });
  assert.equal(replay.headers.get('location'), '/login?error=state');
  const other = await beginLogin(base);
  const denied = await fetch(`${config.discord.redirectUri}?code=${DENIED}&state=${other.url.searchParams.get('state')}`,
    { redirect: 'manual', headers: { Cookie: other.cookie } });
  assert.equal(denied.headers.get('location'), '/login?error=denied');
  assert.ok(!denied.headers.getSetCookie().some(value => value.startsWith('fay_session=')));
});

test('OAuth-state uit een andere browser werkt niet en ontbrekende code wordt geweigerd', async t => {
  const { base, config } = await fixture(t);
  const first = await beginLogin(base);
  const second = await beginLogin(base);
  const result = await fetch(`${config.discord.redirectUri}?state=${first.url.searchParams.get('state')}&code=${ADMIN}`,
    { redirect: 'manual', headers: { Cookie: second.cookie } });
  assert.equal(result.headers.get('location'), '/login?error=state');
  const missingCode = await fetch(`${config.discord.redirectUri}?state=${second.url.searchParams.get('state')}`,
    { redirect: 'manual', headers: { Cookie: second.cookie } });
  assert.equal(missingCode.headers.get('location'), '/login?error=state');
});

test('alleen admin beheert IDs; verwijderen trekt sessies en SSE direct in', { timeout: 5000 }, async t => {
  const { config, base } = await fixture(t);
  const adminFetch = authenticatedFetch(await signIn(config));
  const memberCookie = await signIn(config, MEMBER);
  const memberFetch = authenticatedFetch(memberCookie);
  assert.equal((await memberFetch(base + '/api/commands')).status, 200);
  assert.equal((await memberFetch(base + '/api/access')).status, 403);
  const access = await (await adminFetch(base + '/api/access')).json();
  assert.deepEqual(access.protectedIds, [ADMIN]);
  const headers = { Origin: base, 'Content-Type': 'application/json', 'X-Requested-With': 'faynominaal' };
  assert.equal((await memberFetch(base + '/api/access', { method: 'POST', headers, body: JSON.stringify(access) })).status, 403);
  const stream = await memberFetch(base + '/api/events');
  const reader = stream.body!.getReader();
  await reader.read();
  const save = await adminFetch(base + '/api/access', { method: 'POST', headers,
    body: JSON.stringify({ ...access, users: access.users.filter((user: { id: string }) => user.id !== MEMBER) }) });
  assert.equal(save.status, 200);
  assert.equal((await reader.read()).done, true);
  assert.equal((await memberFetch(base + '/api/commands')).status, 401);
  const next = await save.json();
  const restore = await adminFetch(base + '/api/access', { method: 'POST', headers,
    body: JSON.stringify({ ...next, users: [...next.users, { id: MEMBER, role: 'member' }] }) });
  assert.equal(restore.status, 200);
  assert.equal((await memberFetch(base + '/api/commands')).status, 401);
  assert.equal((await authenticatedFetch(await signIn(config, MEMBER))(base + '/api/commands')).status, 200);
});

test('uitloggen vereist same-origin POST en wist de sessie', async t => {
  const { config, base } = await fixture(t);
  const userFetch = authenticatedFetch(await signIn(config));
  const status = await (await userFetch(base + '/auth/session')).json();
  assert.equal(status.user.role, 'admin');
  assert.equal((await userFetch(base + '/auth/logout', { method: 'POST' })).status, 403);
  assert.equal((await userFetch(base + '/auth/logout', { method: 'POST', headers: {
    Origin: base, 'X-Requested-With': 'faynominaal'
  } })).status, 204);
  assert.equal((await userFetch(base + '/api/config')).status, 401);
  assert.equal((await (await userFetch(base + '/auth/session')).json()).authenticated, false);
});

test('toegangslijst bewaart IDs exact, voorkomt lockout, conflicten en dataverlies', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'fay-access-'));
  assert.ok(directory.startsWith(join(tmpdir(), 'fay-access-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'access.json');
  const store = await loadAccessStore(path, [ADMIN]);
  const initial = store.snapshot();
  assert.throws(() => store.save({ ...initial, users: [] }), /Vaste beheerders/);
  assert.throws(() => store.save({ ...initial, users: [{ id: ADMIN, role: 'member' }] }));
  assert.throws(() => store.save({ ...initial, users: [{ id: Number(ADMIN), role: 'admin' }] }));
  const saved = await store.save({ ...initial, users: [...initial.users, { id: MEMBER, role: 'member' }] });
  assert.equal(saved.revision, 1);
  await assert.rejects(store.save(initial), /gewijzigd/);
  const restarted = await loadAccessStore(path, [ADMIN]);
  assert.equal(restarted.role(MEMBER), 'member');
  const before = await readFile(path, 'utf8');
  assert.throws(() => store.save({ ...saved, users: [...saved.users, { id: MEMBER, role: 'admin' }] }));
  assert.equal(await readFile(path, 'utf8'), before);
  await writeFile(path, 'kapot');
  await assert.rejects(loadAccessStore(path, [ADMIN]), /Herstel/);
});

test('OAuth-client gebruikt vaste Discord-endpoints en stuurt Client Secret alleen naar tokenendpoint', async () => {
  const config = readConfig({ DISCORD_CLIENT_ID: ADMIN, DISCORD_CLIENT_SECRET: 'private-secret', DISCORD_ADMIN_IDS: ADMIN }).discord;
  const calls: { url: string; init?: RequestInit }[] = [];
  const request: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    return Response.json(url.endsWith('/token') ? { access_token: 'private-token' }
      : { id: ADMIN, username: 'test', global_name: '<Admin>' });
  };
  const user = await createDiscordProvider(config, request).identify('one-time-code');
  assert.deepEqual(user, { id: ADMIN, name: '<Admin>' });
  assert.equal(calls[0].url, 'https://discord.com/api/oauth2/token');
  const body = calls[0].init!.body as URLSearchParams;
  assert.equal(body.get('client_secret'), 'private-secret');
  assert.equal(body.get('redirect_uri'), config.redirectUri);
  assert.equal(calls[1].url, 'https://discord.com/api/v10/users/@me');
  assert.equal(new Headers(calls[1].init!.headers).get('authorization'), 'Bearer private-token');
  assert.ok(!JSON.stringify(user).includes('private'));
  assert.throws(() => readConfig({ DISCORD_REDIRECT_URI: 'https://evil.example/auth/discord/callback' }));
});

test('inlogstate en sessies verlopen en kunnen na intrekken niet hergebruikt worden', () => {
  let now = 0;
  const sessions = createSessionStore(() => now);
  const flow = sessions.begin();
  now = 600_000;
  assert.equal(sessions.consume(flow.state, flow.browser), false);
  const token = sessions.create({ id: ADMIN, name: 'Admin' });
  assert.equal(sessions.get(token)?.id, ADMIN);
  now += 8 * 60 * 60_000;
  assert.equal(sessions.get(token), undefined);
  const revoked = sessions.create({ id: MEMBER, name: 'Lid' });
  sessions.prune(id => id === ADMIN);
  assert.equal(sessions.get(revoked), undefined);
});
