import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createEulerAccess } from '../src/server/euler-access.ts';
import { createLive } from '../src/server/live.ts';
import { readConfig } from '../src/server/config.ts';
import { createCommandStore } from '../src/server/command-store.ts';
import { createTestApp, signIn, authenticatedFetch } from './auth-fixture.ts';
import type { LiveEvent } from '../src/shared/events.ts';

test('Euler controleert de scope, bewaart geen accountgegevens en begrenst aanvragen', async () => {
  let calls = 0;
  let time = Date.parse('2026-10-16T12:00:00Z');
  let scopes: number[] = [];
  const access = createEulerAccess('TEST_KEY', () => {}, async key => {
    calls++;
    assert.equal(key, 'TEST_KEY');
    return { account: { scopes, expires_at: null, webhook_secret: 'SECRET', name: 'PRIVATE' } };
  }, () => time);
  assert.equal(access.canSend(), false);
  assert.equal((await access.refresh()).chat, false);
  scopes = [6]; // Business alone does not grant Webcast Premium.
  time += 30_000;
  assert.equal((await access.refresh(true)).chat, false);
  scopes = [13];
  await access.refresh(true);
  assert.equal(calls, 2);
  time += 30_000;
  const [first, second] = await Promise.all([access.refresh(true), access.refresh(true)]);
  assert.equal(calls, 3);
  assert.deepEqual(first, second);
  assert.equal(access.canSend(), true);
  assert.equal(first.moderation, true);
  assert.ok(!JSON.stringify(first).match(/TEST_KEY|SECRET|PRIVATE|scopes/));
  time += 300_000;
  assert.equal(access.canSend(), false);
  scopes = [];
  assert.equal((await access.refresh()).state, 'unavailable');
});

test('ontbrekende, verlopen, onbekende of onbereikbare accountrechten geven geen toegang', async () => {
  let called = false;
  const missing = createEulerAccess(undefined, () => {}, async () => { called = true; });
  assert.equal((await missing.refresh()).state, 'unavailable');
  assert.equal(called, false);
  for (const data of [null, {}, { account: { scopes: [13] } },
    { account: { scopes: ['13'], expires_at: null } },
    { account: { scopes: [13], expires_at: '2020-01-01' } }]) {
    const access = createEulerAccess('key', () => {}, async () => data);
    assert.equal((await access.refresh()).chat, false);
    assert.equal(access.canSend(), false);
  }
  let fail = false;
  let time = Date.now();
  const access = createEulerAccess('key', () => {}, async () => {
    if (fail) throw new Error('sessionid=SECRET');
    return { account: { scopes: [13], expires_at: null } };
  }, () => time);
  await access.refresh();
  fail = true;
  time += 30_000;
  const result = await access.refresh(true);
  assert.equal(result.state, 'unknown');
  assert.equal(access.canSend(), false);
  assert.ok(!JSON.stringify(result).includes('SECRET'));
});

test('Community blijft chat ontvangen maar stuurt geen commands; intrekken stopt een antwoordreeks', async () => {
  let instance!: Fake;
  let allowed = false;
  const sent: string[] = [];
  class Fake extends EventEmitter {
    constructor() { super(); instance = this; }
    async connect() {}
    async disconnect() {}
    async sendMessage(text: string) { sent.push(text); allowed = false; }
  }
  const events: LiveEvent[] = [];
  const config = readConfig({ BOT_ENABLED: 'true', EULER_API_KEY: 'fake', TIKTOK_SESSION_ID: 'fake', TIKTOK_TARGET_IDC: 'fake' });
  const live = createLive(config, event => events.push(event), async () => ({ TikTokLiveConnection: Fake }),
    () => [{ trigger: '!test', responses: ['Een', 'Twee'], cooldownSeconds: 5, enabled: true }], () => allowed);
  await live.connect();
  instance.emit('chat', { content: '!test' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sent.length, 0);
  assert.equal(events.filter(event => event.type === 'chat').length, 1);
  allowed = true;
  instance.emit('chat', { content: '!test' });
  await new Promise(resolve => setTimeout(resolve, 1100));
  assert.deepEqual(sent, ['Een']);
  await live.stop();
});

test('commands-API weigert Community-writes en laat opgeslagen commands intact', async t => {
  const config = readConfig({});
  const store = createCommandStore();
  const before = store.snapshot();
  const app = createTestApp(config, undefined, store, undefined,
    async () => ({ account: { scopes: [], expires_at: null, webhook_secret: 'SECRET' } }));
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  config.port = (app.server.address() as AddressInfo).port;
  t.after(() => app.close());
  const base = `http://127.0.0.1:${config.port}`;
  assert.equal((await fetch(base + '/api/capabilities')).status, 401);
  const request = authenticatedFetch(await signIn(config));
  const capabilities = await (await request(base + '/api/capabilities')).json();
  assert.equal(capabilities.state, 'unavailable');
  assert.equal(capabilities.chat, false);
  const result = await request(base + '/api/commands', { method: 'POST',
    headers: { Origin: base, 'X-Requested-With': 'faynominaal', 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...before, commands: [] }) });
  assert.equal(result.status, 403);
  assert.deepEqual(store.snapshot(), before);
  assert.equal((await request(base + '/api/capabilities', { method: 'POST' })).status, 403);
  const snapshot = await (await request(base + '/api/snapshot')).json();
  assert.equal(snapshot.capabilities.chat, false);
  assert.ok(!JSON.stringify(snapshot).includes('SECRET'));
});
