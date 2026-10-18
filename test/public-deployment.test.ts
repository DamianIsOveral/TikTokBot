import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { TestContext } from 'node:test';
import { readConfig } from '../src/server/config.ts';
import { ADMIN, DENIED, createTestApp } from './auth-fixture.ts';

const origin = 'https://dashboard.example.com';
const publicEnv = { HOST: '0.0.0.0', PUBLIC_ORIGIN: origin, DISCORD_CLIENT_ID: ADMIN,
  DISCORD_CLIENT_SECRET: 'offline-secret', DISCORD_ADMIN_IDS: ADMIN };

test('publieke configuratie vereist HTTPS-origin, vaste callback en Discord-toegang', () => {
  const config = readConfig(publicEnv);
  assert.equal(config.publicOrigin, origin);
  assert.equal(config.discord.redirectUri, `${origin}/auth/discord/callback`);
  for (const PUBLIC_ORIGIN of ['http://example.com', 'https://example.com/path', 'https://example.com/?x=1',
    'https://example.com/#fragment', 'https://user:pass@example.com', 'https://localhost', 'https://127.0.0.1', 'https://[::1]']) {
    assert.throws(() => readConfig({ ...publicEnv, PUBLIC_ORIGIN }), PUBLIC_ORIGIN);
  }
  for (const key of ['DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'DISCORD_ADMIN_IDS', 'PUBLIC_ORIGIN']) {
    assert.throws(() => readConfig({ ...publicEnv, [key]: '' }), key);
  }
  for (const DISCORD_REDIRECT_URI of ['http://127.0.0.1:3000/auth/discord/callback',
    'https://evil.example/auth/discord/callback', `${origin}/wrong`, `${origin}/auth/discord/callback?x=1`]) {
    assert.throws(() => readConfig({ ...publicEnv, DISCORD_REDIRECT_URI }), DISCORD_REDIRECT_URI);
  }
  assert.throws(() => readConfig({ ...publicEnv, HOST: '192.0.2.1' }));
  assert.equal(readConfig({ ...publicEnv, HOST: '::' }).host, '::');
  assert.equal(readConfig({ ...publicEnv, PUBLIC_ORIGIN: origin + '/' }).publicOrigin, origin);
});

async function fixture(t: TestContext) {
  const config = readConfig(publicEnv);
  const app = createTestApp(config);
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  config.port = (app.server.address() as AddressInfo).port;
  t.after(() => app.close());
  async function request(path: string, headers: Record<string, string> = {}, method = 'GET') {
    return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port: config.port, path, method,
        headers: { Host: new URL(origin).host, ...headers } }, res => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body }));
      });
      req.on('error', reject);
      req.end();
    });
  }
  async function login(id = ADMIN) {
    const flow = await request('/auth/login');
    const target = new URL(flow.headers.location!);
    const response = await request(`/auth/discord/callback?code=${id}&state=${target.searchParams.get('state')}`,
      { Cookie: flow.headers['set-cookie']![0].split(';')[0], 'Sec-Fetch-Site': 'cross-site' });
    return { flow, target, response, cookie: response.headers['set-cookie']?.find(value => value.startsWith('fay_session=')) };
  }
  return { config, request, login };
}

test('proxy bewaart hostcontrole en schermt dashboard, APIs en privébestanden af', async t => {
  const { config, request } = await fixture(t);
  assert.equal((await request('/')).headers.location, '/login');
  assert.equal((await request('/login')).status, 200);
  assert.equal((await request('/health')).status, 200);
  assert.equal((await request('/health', { Host: `127.0.0.1:${config.port}` })).status, 200);
  for (const path of ['/', '/login', '/auth/session', '/api/config']) {
    assert.equal((await request(path, { Host: `127.0.0.1:${config.port}` })).status, 403);
    assert.equal((await request(path, { Host: 'evil.example', 'X-Forwarded-Host': new URL(origin).host,
      'X-Forwarded-Proto': 'https' })).status, 403);
  }
  for (const path of ['/api/config', '/api/events', '/api/access', '/api/commands', '/api/bot-session', '/api/diagnostics']) {
    assert.equal((await request(path)).status, 401, path);
  }
  for (const path of ['/.env', '/data/tiktok-session.json', '/src/server/config.ts']) {
    assert.equal((await request(path)).status, 404, path);
  }
  assert.equal((await request('/api/config', { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
});

test('HTTPS OAuth gebruikt Secure cookies, weigert onbekende IDs en valideert mutatie-origin', async t => {
  const { request, login } = await fixture(t);
  const { flow, target, response, cookie } = await login();
  assert.equal(target.searchParams.get('redirect_uri'), `${origin}/auth/discord/callback`);
  assert.match(flow.headers['set-cookie']![0], /; Secure$/);
  assert.equal(response.status, 302);
  assert.equal(response.headers.location, '/');
  assert.ok(cookie);
  assert.match(cookie, /HttpOnly; SameSite=Lax; Max-Age=28800; Secure$/);
  assert.match(response.headers['set-cookie']![0], /Max-Age=0; Secure$/);
  const headers = { Cookie: cookie.split(';')[0], 'X-Requested-With': 'faynominaal' };
  const home = await request('/', headers);
  assert.equal(home.status, 200);
  assert.equal(home.headers['strict-transport-security'], 'max-age=31536000');
  assert.equal((await request('/api/config', headers)).status, 200);
  for (const Origin of ['https://evil.example', 'http://dashboard.example.com', 'null', '']) {
    assert.equal((await request('/api/stop', { ...headers, Origin, 'X-Forwarded-Proto': 'https',
      'X-Forwarded-Host': 'evil.example' }, 'POST')).status, 403, Origin);
  }
  assert.equal((await request('/api/stop', { Cookie: headers.Cookie, Origin: origin }, 'POST')).status, 403);
  assert.equal((await request('/api/stop', { ...headers, Origin: origin }, 'POST')).status, 202);
  const denied = await login(DENIED);
  assert.equal(denied.response.headers.location, '/login?error=denied');
  assert.equal(denied.cookie, undefined);
  assert.equal((await request('/auth/logout', { ...headers, Origin: origin }, 'POST')).status, 204);
  assert.equal((await request('/api/config', headers)).status, 401);
});
