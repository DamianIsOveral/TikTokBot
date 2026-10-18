import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createCommandLimiter } from '../src/server/command-limiter.ts';
import { createLive } from '../src/server/live.ts';
import { readConfig } from '../src/server/config.ts';
import { routeDiagnostics } from '../src/server/http/diagnostic-routes.ts';
import type { ChatAccess } from '../src/server/chat-access.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createTestApp, authenticatedFetch, signIn } from './auth-fixture.ts';

test('snapshot volgt actieve antwoorden, interval, batchpauze en triggercooldowns zonder gebruikers', () => {
  let now = 100_000;
  const limiter = createCommandLimiter(() => now);
  assert.equal(limiter.snapshot().nextReadyAt, now);
  const ticket = limiter.reserve(1, '!socials', 'PRIVATE_VIEWER', 60)!;
  assert.equal(limiter.snapshot().busy, true);
  assert.equal(limiter.snapshot().nextReadyAt, null);
  now += 90_000;
  assert.equal(limiter.snapshot().nextReadyAt, null, 'busy blijft blokkeren als alle timers verstreken zijn');
  ticket.record(); ticket.close();
  const status = limiter.snapshot();
  assert.equal(status.serverNow, now);
  assert.equal(status.intervalReadyAt, now + 30_000);
  assert.equal(status.batchReadyAt, now + 10_000);
  assert.equal(status.nextReadyAt, now + 30_000);
  assert.ok(!JSON.stringify(status).includes('PRIVATE_VIEWER'));
  now += 30_000;
  const next = limiter.reserve(1, '!other', 'PRIVATE_OTHER', 120)!;
  next.close();
  assert.deepEqual(limiter.snapshot().triggerCooldowns, [{ trigger: '!other', nextReadyAt: now + 120_000 }]);
  assert.equal(limiter.snapshot().nextReadyAt, now + 10_000, 'batchpauze geldt ook zonder verzending');
  now += 120_000;
  assert.deepEqual(limiter.snapshot().triggerCooldowns, []);
  assert.equal(limiter.snapshot().nextReadyAt, now);
});

test('snapshot berekent de eerst vrijkomende minuut- en uurbudgetplaats, ook na limietverlaging', () => {
  let now = 100_000;
  let hourLimit = 20;
  const limiter = createCommandLimiter(() => now, () => ({ intervalSeconds: 30, maxMessagesPerHour: hourLimit }));
  const ticket = limiter.reserve(1, '!test', 'viewer', 30)!;
  for (let index = 0; index < 10; index++) { ticket.record(); now += 1000; }
  ticket.close();
  const status = limiter.snapshot();
  assert.deepEqual(status.minute, { remaining: 0, limit: 10, nextReadyAt: 160_000 });
  assert.equal(status.nextReadyAt, 160_000);
  hourLimit = 5;
  assert.deepEqual(limiter.snapshot().hour, { remaining: 0, limit: 5, nextReadyAt: 3_705_000 });
  assert.equal(limiter.snapshot().nextReadyAt, 3_705_000);
  now = 3_705_000;
  assert.equal(limiter.snapshot().hour.remaining, 1);
  assert.equal(limiter.snapshot().nextReadyAt, now);
  now = 3_709_000;
  assert.equal(limiter.snapshot().hour.remaining, 5);
});

test('LIVE stop en herverbinding behouden commandolimieten', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 100_000 });
  let connector!: Fake;
  let sent!: () => void;
  const completed = new Promise<void>(resolve => { sent = resolve; });
  class Fake extends EventEmitter {
    constructor() { super(); connector = this; }
    async connect() {}
    async disconnect() {}
    async sendMessage() { sent(); }
  }
  const live = createLive(readConfig({ BOT_ENABLED: 'true', EULER_API_KEY: 'offline', TIKTOK_SESSION_ID: 'offline', TIKTOK_TARGET_IDC: 'test' }),
    () => {}, async () => ({ TikTokLiveConnection: Fake }),
    () => [{ trigger: '!test', responses: ['Test'], enabled: true, cooldownSeconds: 60 }], () => true,
    undefined, () => () => {});
  t.after(() => live.stop());
  await live.connect();
  connector.emit('chat', { content: '!test', user: { uniqueId: 'PRIVATE_VIEWER' } });
  await completed;
  await new Promise(resolve => setImmediate(resolve));
  const before = live.commandStatus();
  assert.equal(before.busy, false);
  assert.equal(before.nextReadyAt, 130_000);
  await live.stop(); await live.connect();
  assert.deepEqual(live.commandStatus(), before);
});

test('commandstatus API vereist Discord, is read-only en bevat geen secrets', async t => {
  const config = readConfig({ EULER_API_KEY: 'PRIVATE_KEY', TIKTOK_SESSION_ID: 'PRIVATE_SESSION', TIKTOK_TARGET_IDC: 'test' });
  const app = createTestApp(config);
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  config.port = (app.server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${config.port}`;
  assert.equal((await fetch(base + '/api/command-status')).status, 401);
  const request = authenticatedFetch(await signIn(config));
  const response = await request(base + '/api/command-status');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('content-type')!, /application\/json/);
  const result = await response.json();
  assert.equal(result.state, 'disabled');
  assert.equal(typeof result.serverNow, 'number');
  assert.deepEqual(result.triggerCooldowns, []);
  assert.ok(!/PRIVATE|sessionid|Cookie|users|username/i.test(JSON.stringify(result)));
  assert.equal((await request(base + '/api/command-status', { method: 'POST' })).status, 405);
});

test('server kiest commandobeschikbaarheid uit bot-, LIVE-, sessie- en limiterstatus', () => {
  const live = createLive(readConfig({}), () => {});
  const base = live.commandStatus();
  let connected = false;
  let chat = false;
  let status = base;
  const fakeLive = { ...live, diagnostics: () => ({ ...live.diagnostics(), connected }), commandStatus: () => status };
  const access = { snapshot: () => ({ chat }) } as ChatAccess;
  const read = (enabled = true) => {
    let body = '';
    const response = { setHeader() {}, end(value: string) { body = value; } } as unknown as ServerResponse;
    assert.equal(routeDiagnostics({ url: '/api/command-status', method: 'GET' } as IncomingMessage, response, fakeLive, access, enabled), true);
    return JSON.parse(body).state;
  };
  assert.equal(read(false), 'disabled');
  assert.equal(read(), 'disconnected');
  connected = true;
  assert.equal(read(), 'session-unavailable');
  chat = true;
  status = { ...base, busy: true, nextReadyAt: null };
  assert.equal(read(), 'responding');
  status = { ...base, nextReadyAt: base.serverNow + 1000 };
  assert.equal(read(), 'cooldown');
  status = base;
  assert.equal(read(), 'ready');
});
