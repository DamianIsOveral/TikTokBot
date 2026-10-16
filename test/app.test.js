import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import { readConfig } from '../src/config.js';
import { createCommands } from '../src/commands.js';
import { createLive } from '../src/live.js';
import { createApp } from '../src/server.js';

test('config beschermt publieke binding en onvolledige credentials', () => {
  assert.throws(() => readConfig({ HOST: '0.0.0.0' }));
  assert.throws(() => readConfig({ EULER_API_KEY: 'dummy' }));
  assert.throws(() => readConfig({ BOT_ENABLED: 'true' }));
  assert.equal(readConfig({}).botEnabled, false);
});

test('commando cooldown, botfilter en verzendinterval', async () => {
  let time = 100_000;
  const sent = [];
  const waits = [];
  const command = createCommands({
    send: async text => sent.push(text), active: () => true, botUsername: 'bot',
    report: assert.fail, now: () => time,
    wait: async ms => { waits.push(ms); time += ms; }
  });
  await command({ content: '!discord', user: { displayId: 'bot' } });
  assert.equal(sent.length, 0);
  await command({ content: '!socials' });
  assert.equal(sent.length, 6);
  assert.deepEqual(waits, [0, 1000, 1000, 1000, 1000, 1000]);
  await command({ content: '!socials' });
  assert.equal(sent.length, 6);
});

test('stop tijdens verbinden laat geen actieve verbinding achter', async () => {
  let finish;
  let disconnects = 0;
  class Fake extends EventEmitter {
    connect() { return new Promise(resolve => { finish = resolve; }); }
    async disconnect() { disconnects++; }
  }
  const events = [];
  const live = createLive(readConfig({}), event => events.push(event), async () => ({ TikTokLiveConnection: Fake }));
  const connecting = live.connect();
  await new Promise(resolve => setImmediate(resolve));
  await live.stop();
  finish();
  await connecting;
  assert.ok(disconnects >= 1);
  assert.equal(live.status, 'Gestopt · Niet verbonden');
  assert.ok(!events.some(event => event.text.startsWith('LIVE verbonden')));
});

test('HTTP beschermt secrets en weigert cross-origin mutaties', async t => {
  const config = readConfig({});
  const app = createApp(config);
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  config.port = app.server.address().port;
  t.after(() => app.close());
  const base = `http://127.0.0.1:${config.port}`;
  const home = await fetch(base);
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  for (const path of ['/.env', '/src/config.js', '/.git/config', '/.local-archive/faynominaalbot/.env']) {
    assert.equal((await fetch(base + path)).status, 404);
  }
  assert.equal((await fetch(base + '/api/connect', { method: 'POST' })).status, 403);
  assert.equal((await fetch(base + '/api/connect', { method: 'POST',
    headers: { Origin: 'https://evil.example', 'X-Requested-With': 'faynominaal' } })).status, 403);
  assert.equal((await fetch(base + '/api/stop', { method: 'POST',
    headers: { Origin: base, 'X-Requested-With': 'faynominaal' } })).status, 202);
  const publicConfig = await (await fetch(base + '/api/config')).json();
  assert.deepEqual(Object.keys(publicConfig).sort(), ['botEnabled', 'username']);
  const rejected = await new Promise((resolve, reject) => {
    const request = http.get(base, { headers: { Host: 'evil.example' } }, response => {
      response.resume(); resolve(response.statusCode);
    });
    request.on('error', reject);
  });
  assert.equal(rejected, 403);
});
