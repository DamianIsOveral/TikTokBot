import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { readConfig } from '../src/server/config.ts';
import { createAccessStore } from '../src/server/auth/access-store.ts';
import { ADMIN, MEMBER, authenticatedFetch, createTestApp, signIn } from './auth-fixture.ts';

test('gewone dashboardleden kunnen geen servercookies of sleutels uitlezen via publieke APIs of bestanden', async t => {
  const env = { TIKTOK_CHAT_TRANSPORT: 'direct', EULER_API_KEY: 'PRIVATE_EULER_KEY_ABC',
    TIKTOK_SESSION_ID: 'PRIVATE_SESSION_ABC', TIKTOK_TARGET_IDC: 'private-idc-abc',
    TIKTOK_MS_TOKEN: 'PRIVATE_MS_TOKEN_ABC', TIKTOK_VERIFY_FP: 'verify_PRIVATE_ABC' };
  const config = readConfig(env);
  const access = createAccessStore([ADMIN], undefined, { revision: 0, users: [{ id: MEMBER, role: 'member' }] });
  const app = createTestApp(config, undefined, undefined, access, undefined, {
    createSigner: async () => async () => { throw new Error('Geen signing nodig.'); },
    request: async (_input, init) => {
      assert.equal(init?.method, 'GET');
      return Response.json({ data: { username: config.botUsername, user_id: '123' } });
    }
  });
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  config.port = (app.server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${config.port}`;
  const member = authenticatedFetch(await signIn(config, MEMBER));
  const secrets = [...Object.values(env).filter(value => value !== 'direct'), config.discord.clientSecret];
  for (const path of ['/api/config', '/api/snapshot', '/api/diagnostics', '/api/readiness', '/api/commands',
    '/api/capabilities', '/api/filters', '/api/command-status', '/api/branding']) {
    const response = await member(base + path);
    assert.equal(response.status, 200, path);
    const body = await response.text();
    for (const secret of secrets) assert.ok(!body.includes(secret), `${path} exposed a server credential`);
  }
  for (const path of ['/api/access', '/api/bot-session']) {
    assert.equal((await member(base + path)).status, 403, path);
    assert.equal((await member(base + path, { method: 'POST', headers: {
      Origin: base, 'X-Requested-With': 'faynominaal', 'Content-Type': 'application/json'
    }, body: '{}' })).status, 403, path);
  }
  for (const path of ['/.env', '/data/tiktok-session.json', '/data/branding.json', '/secrets/tiktok-session-id',
    '/src/server/config.ts', '/scripts/probe-tiktok.ts', '/.local-archive/signing-research/upstream/vendor/bootstrap.js']) {
    assert.equal((await member(base + path)).status, 404, path);
  }
});
