import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { createLive } from '../src/server/live.ts';
import { readConfig } from '../src/server/config.ts';
import type { LiveEvent } from '../src/shared/events.ts';

function scheduler() {
  const tasks: { callback: () => void; ms: number; cancelled: boolean; fired: boolean }[] = [];
  return {
    tasks,
    schedule(callback: () => void, ms: number): () => void {
      const task = { callback, ms, cancelled: false, fired: false };
      tasks.push(task);
      return () => { task.cancelled = true; };
    },
    async fire(task = tasks.find(item => !item.cancelled && !item.fired)): Promise<void> {
      assert.ok(task, 'Er moet een geplande poging bestaan.');
      task.fired = true; task.callback();
      await new Promise<void>(resolve => setImmediate(resolve));
    },
    active() { return tasks.filter(item => !item.cancelled && !item.fired); }
  };
}

test('reconnect is begrensd op vijf pogingen met oplopende wachttijd en behoudt einddiagnose', async t => {
  const timers = scheduler();
  let attempts = 0;
  class Fake extends EventEmitter {
    constructor() { super(); }
    async connect() { attempts++; throw Object.assign(new Error('Netwerk tijdelijk onbereikbaar.'), { code: 'ECONNRESET' }); }
    async disconnect() {}
    async sendMessage() { assert.fail('Tijdens verbindingsfalen mag geen bericht worden verstuurd.'); }
  }
  const events: LiveEvent[] = [];
  const live = createLive(readConfig({}), event => events.push(event), async () => ({ TikTokLiveConnection: Fake }),
    undefined, undefined, undefined, timers.schedule);
  t.after(() => live.stop());
  await live.connect();
  for (const expected of [5000, 15_000, 30_000, 60_000, 120_000]) {
    assert.equal(timers.active().length, 1); assert.equal(timers.active()[0]!.ms, expected);
    await timers.fire();
  }
  assert.equal(attempts, 6); assert.equal(timers.active().length, 0);
  assert.equal(live.roomId, undefined);
  assert.ok(events.some(event => event.type === 'status' && event.text.includes('(5/5)')));
  assert.ok(!events.some(event => event.type === 'status' && event.phase === 'connected'));
});

test('stop annuleert reconnect en een al ingeplande callback kan niets opnieuw openen', async () => {
  const timers = scheduler();
  let attempts = 0;
  class Fake extends EventEmitter {
    constructor() { super(); }
    async connect() { attempts++; throw new Error('Netwerk tijdelijk onbereikbaar.'); }
    async disconnect() {}
    async sendMessage() { assert.fail(); }
  }
  const live = createLive(readConfig({}), () => {}, async () => ({ TikTokLiveConnection: Fake }),
    undefined, undefined, undefined, timers.schedule);
  await live.connect();
  const queued = timers.active()[0]!;
  await live.stop();
  assert.equal(queued.cancelled, true);
  queued.callback();
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(attempts, 1); assert.equal(timers.active().length, 0);
  assert.equal(live.status, 'Gestopt · Niet verbonden');
});

test('authenticatiefouten, cookie-whitelist, rate limits en uitgeschakelde reconnect starten geen lus', async t => {
  const failures = [
    { status: 401 }, { exception: { status: 403 } }, { cause: { status: 429 } },
    new Error('WHITELIST_AUTHENTICATED_SESSION_ID_HOST ontbreekt.'),
    new Error('De session cookie is verlopen.'), Object.assign(new Error('Verificatie vereist.'), { name: 'SignAPIError' })
  ];
  for (const error of failures) {
    const timers = scheduler();
    class Fake extends EventEmitter {
      constructor() { super(); }
      async connect() { throw error; }
      async disconnect() {}
      async sendMessage() { assert.fail(); }
    }
    const live = createLive(readConfig({}), () => {}, async () => ({ TikTokLiveConnection: Fake }),
      undefined, undefined, undefined, timers.schedule);
    t.after(() => live.stop());
    await live.connect();
    assert.equal(timers.active().length, 0);
  }
  const timers = scheduler();
  class Fake extends EventEmitter {
    constructor() { super(); }
    async connect() { throw new Error('Netwerk tijdelijk onbereikbaar.'); }
    async disconnect() {}
    async sendMessage() { assert.fail(); }
  }
  const live = createLive(readConfig({ LIVE_AUTO_RECONNECT: 'false' }), () => {}, async () => ({ TikTokLiveConnection: Fake }),
    undefined, undefined, undefined, timers.schedule);
  t.after(() => live.stop()); await live.connect();
  assert.equal(timers.active().length, 0);
});

test('een verbroken verbinding wordt opnieuw geopend; alleen een stabiele minuut reset het pogingbudget', async t => {
  const timers = scheduler();
  const instances: Fake[] = [];
  class Fake extends EventEmitter {
    readonly roomId = '7300000000000000001';
    constructor() { super(); instances.push(this); }
    async connect() {}
    async disconnect() { this.emit('disconnected'); }
    async sendMessage() { assert.fail(); }
  }
  const live = createLive(readConfig({}), () => {}, async () => ({ TikTokLiveConnection: Fake }),
    undefined, undefined, undefined, timers.schedule);
  t.after(() => live.stop()); await live.connect();
  assert.equal(live.roomId, instances[0]!.roomId);
  const firstStable = timers.active()[0]!;
  instances[0]!.emit('disconnected');
  assert.equal(firstStable.cancelled, true); assert.equal(live.roomId, undefined);
  assert.equal(timers.active()[0]!.ms, 5000); await timers.fire();
  instances[1]!.emit('disconnected');
  assert.equal(timers.active()[0]!.ms, 15_000); await timers.fire();
  const stable = timers.active()[0]!;
  assert.equal(stable.ms, 60_000); await timers.fire(stable);
  instances[2]!.emit('disconnected');
  assert.equal(timers.active()[0]!.ms, 5000);
});

test('stop tijdens connect voorkomt laat succes en alle chatverzending via oude eventhandlers', async () => {
  const timers = scheduler();
  let finish!: () => void;
  let instance!: Fake;
  let sends = 0;
  class Fake extends EventEmitter {
    readonly roomId = '7300000000000000001';
    constructor() { super(); instance = this; }
    connect() { return new Promise<void>(resolve => { finish = resolve; }); }
    async disconnect() { this.emit('disconnected'); }
    async sendMessage() { sends++; }
  }
  const config = readConfig({ BOT_ENABLED: 'true', EULER_API_KEY: 'FAKE_KEY',
    TIKTOK_SESSION_ID: 'FAKE_SESSION', TIKTOK_TARGET_IDC: 'fake-idc' });
  const events: LiveEvent[] = [];
  const live = createLive(config, event => events.push(event), async () => ({ TikTokLiveConnection: Fake }),
    () => [{ trigger: '!test', responses: ['Fake antwoord'], cooldownSeconds: 30, enabled: true }], () => true,
    undefined, timers.schedule);
  const connecting = live.connect();
  await new Promise<void>(resolve => setImmediate(resolve));
  instance.emit('chat', { content: '!test', user: { uniqueId: 'fake_viewer' } });
  await live.stop(); finish(); await connecting;
  instance.emit('chat', { content: '!test', user: { uniqueId: 'fake_viewer' } });
  await delay(10);
  assert.equal(sends, 0); assert.equal(live.roomId, undefined); assert.equal(timers.active().length, 0);
  assert.equal(live.status, 'Gestopt · Niet verbonden');
  assert.ok(!events.some(event => event.type === 'status' && event.phase === 'connected'));
});

test('trigger-, gebruikers- en batchcooldown blijven na reconnect bestaan', async t => {
  let time = 1_000_000;
  t.mock.method(Date, 'now', () => time);
  const timers = scheduler();
  const instances: Fake[] = [];
  const sent: string[] = [];
  class Fake extends EventEmitter {
    constructor() { super(); instances.push(this); }
    async connect() {}
    async disconnect() { this.emit('disconnected'); }
    async sendMessage(text: string) { sent.push(text); }
  }
  const config = readConfig({ BOT_ENABLED: 'true', EULER_API_KEY: 'FAKE_KEY',
    TIKTOK_SESSION_ID: 'FAKE_SESSION', TIKTOK_TARGET_IDC: 'fake-idc' });
  const commands = ['!first', '!second'].map(trigger => ({ trigger, responses: [trigger], cooldownSeconds: 3600, enabled: true }));
  const live = createLive(config, () => {}, async () => ({ TikTokLiveConnection: Fake }), () => commands,
    () => true, undefined, timers.schedule);
  t.after(() => live.stop()); await live.connect();
  instances[0]!.emit('chat', { content: '!first', user: { uniqueId: 'viewer1' } });
  await delay(10); assert.deepEqual(sent, ['!first']);
  instances[0]!.emit('disconnected'); time += 5000; await timers.fire();
  instances[1]!.emit('chat', { content: '!first', user: { uniqueId: 'viewer2' } });
  instances[1]!.emit('chat', { content: '!second', user: { uniqueId: 'viewer2' } });
  await delay(10); assert.deepEqual(sent, ['!first']);
  time += 10_000;
  instances[1]!.emit('chat', { content: '!first', user: { uniqueId: 'viewer2' } });
  instances[1]!.emit('chat', { content: '!second', user: { uniqueId: 'viewer1' } });
  await delay(10); assert.deepEqual(sent, ['!first']);
});
