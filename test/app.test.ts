import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import { readConfig } from '../src/server/config.ts';
import { createCommands } from '../src/server/commands.ts';
import { createLive } from '../src/server/live.ts';
import { createTestApp as createApp, signIn, authenticatedFetch } from './auth-fixture.ts';
import { loadConnector } from '../src/server/connector.ts';

test('connectoradapter laadt de SDK zonder TikTok-verbinding', async () => {
  const connector = await loadConnector();
  assert.equal(typeof connector.TikTokLiveConnection, 'function');
});

test('config beschermt publieke binding en onvolledige credentials', () => {
  assert.throws(() => readConfig({ HOST: '0.0.0.0' }));
  assert.throws(() => readConfig({ EULER_API_KEY: 'dummy' }));
  assert.throws(() => readConfig({ BOT_ENABLED: 'true' }));
  assert.equal(readConfig({}).botEnabled, false);
});

test('commando cooldown, botfilter en verzendinterval', async () => {
  let time = 100_000;
  const sent: string[] = [];
  const waits: number[] = [];
  const command = createCommands({
    send: async text => sent.push(text), active: () => true, botUsername: 'bot',
    report: assert.fail, now: () => time,
    wait: async ms => { waits.push(ms); time += ms; }
  });
  await command({ content: '!discord', user: { displayId: 'bot' } });
  assert.equal(sent.length, 0);
  await command({ content: '!socials' });
  assert.equal(sent.length, 6);
  assert.deepEqual(waits, [0, 30000, 30000, 30000, 30000, 30000]);
  await command({ content: '!socials' });
  assert.equal(sent.length, 6);
});

test('stop tijdens verbinden laat geen actieve verbinding achter', async () => {
  let finish!: () => void;
  let disconnects = 0;
  class Fake extends EventEmitter {
    constructor() { super(); }
    connect() { return new Promise<void>(resolve => { finish = resolve; }); }
    async disconnect() { disconnects++; }
    async sendMessage() {}
  }
  const events: import('../src/shared/events.ts').LiveEvent[] = [];
  const live = createLive(readConfig({}), event => events.push(event), async () => ({ TikTokLiveConnection: Fake }));
  const connecting = live.connect();
  await new Promise(resolve => setImmediate(resolve));
  await live.stop();
  finish();
  await connecting;
  assert.ok(disconnects >= 1);
  assert.equal(live.status, 'Gestopt · Niet verbonden');
  assert.ok(!events.some(event => event.type === 'status' && event.text.startsWith('LIVE verbonden')));
});

test('HTTP beschermt secrets en weigert cross-origin mutaties', async t => {
  const config = readConfig({});
  const app = createApp(config);
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  config.port = (app.server.address() as import('node:net').AddressInfo).port;
  t.after(() => app.close());
  const base = `http://127.0.0.1:${config.port}`;
  const fetch = authenticatedFetch(await signIn(config));
  const home = await fetch(base);
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
  assert.match(await home.text(), /type="module" src="\/assets\/app.js"/);
  const modules = new Set<string>();
  const queue = ['/assets/app.js'];
  while (queue.length) {
    const path = queue.shift()!;
    if (modules.has(path)) continue;
    modules.add(path);
    const asset = await fetch(base + path);
    assert.equal(asset.status, 200, path);
    assert.match(asset.headers.get('content-type') || '', /text\/javascript/);
    for (const match of (await asset.text()).matchAll(/from ['"]([^'"]+)['"]/g)) {
      queue.push(new URL(match[1], base + path).pathname);
    }
  }
  assert.equal(modules.size, 37);
  assert.ok(modules.has('/assets/sessionpack.js'));
  for (const path of ['/review-actions.css','/activity-resize.css']) {
    const asset=await fetch(base+path);
    assert.equal(asset.status,200);
    assert.match(asset.headers.get('content-type')||'',/text\/css/);
  }
  for (const path of ['/.env', '/src/server/config.ts', '/assets/app.ts', '/.git/config', '/.local-archive/faynominaalbot/.env']) {
    assert.equal((await fetch(base + path)).status, 404);
  }
  assert.equal((await fetch(base + '/api/connect', { method: 'POST' })).status, 403);
  assert.equal((await fetch(base + '/api/connect', { method: 'POST',
    headers: { Origin: 'https://evil.example', 'X-Requested-With': 'faynominaal' } })).status, 403);
  assert.equal((await fetch(base + '/api/stop', { method: 'POST',
    headers: { Origin: base, 'X-Requested-With': 'faynominaal' } })).status, 202);
  const publicConfig = await (await fetch(base + '/api/config')).json();
  assert.deepEqual(Object.keys(publicConfig).sort(), ['botEnabled', 'botUsername', 'username']);
  assert.equal(publicConfig.botUsername,'faynominaalbot');
  const rejected = await new Promise((resolve, reject) => {
    const request = http.get(base, { headers: { Host: 'evil.example' } }, response => {
      response.resume(); resolve(response.statusCode);
    });
    request.on('error', reject);
  });
  assert.equal(rejected, 403);
});
