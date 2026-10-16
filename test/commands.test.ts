import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createCommands } from '../src/server/commands.ts';
import { createCommandStore, loadCommandStore } from '../src/server/command-store.ts';
import { validateCommands } from '../src/server/command-validation.ts';
import { createTestApp as createApp, signIn, authenticatedFetch } from './auth-fixture.ts';
import { readConfig } from '../src/server/config.ts';
import { EventEmitter } from 'node:events';

const command = () => ({ trigger: '!test', responses: ['Eerste', 'Tweede'], cooldownSeconds: 5, enabled: true });

test('bot antwoordt op de server zonder geopend dashboard of SSE-client', { timeout: 5000 }, async t => {
  let connector!: Fake;
  let complete!: (text: string) => void;
  const sent = new Promise<string>(resolve => { complete = resolve; });
  class Fake extends EventEmitter {
    constructor() { super(); connector = this; }
    async connect() {}
    async disconnect() {}
    async sendMessage(text: string) { complete(text); }
  }
  const config = readConfig({ BOT_ENABLED: 'true', EULER_API_KEY: 'dummy', TIKTOK_SESSION_ID: 'dummy', TIKTOK_TARGET_IDC: 'dummy' });
  const store = createCommandStore(undefined, { revision: 0, commands: [{ ...command(), responses: ['Zonder dashboard'] }] });
  const app = createApp(config, async () => ({ TikTokLiveConnection: Fake }), store);
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  config.port = (app.server.address() as AddressInfo).port;
  t.after(() => app.close());
  const base = `http://127.0.0.1:${config.port}`;
  const fetch = authenticatedFetch(await signIn(config));
  await fetch(base + '/api/connect', { method: 'POST', headers: { Origin: base, 'X-Requested-With': 'faynominaal' } });
  connector.emit('chat', { user: { uniqueId: 'kijker' }, content: '!test' });
  assert.equal(await sent, 'Zonder dashboard');
});

test('validatie weigert dubbele triggers, onveilige waarden en te grote antwoorden', () => {
  const valid = { revision: 0, commands: [command()] };
  assert.equal(validateCommands({ ...valid, commands: [{ ...command(), trigger: ' !TEST ' }] }).commands[0].trigger, '!test');
  for (const change of [
    { trigger: '!<script>' }, { responses: [''] }, { responses: ['x'.repeat(201)] },
    { responses: ['a\nb'] }, { responses: Array(11).fill('a') },
    { enabled: 'true' }, { cooldownSeconds: 0 }, { cooldownSeconds: 5.5 }
  ]) assert.throws(() => validateCommands({ ...valid, commands: [{ ...command(), ...change }] }));
  assert.throws(() => validateCommands({ ...valid, commands: [command(), command()] }));
  assert.throws(() => validateCommands({ ...valid, commands: Array(51).fill(command()) }));
});

test('opslag overleeft herstart, voorkomt overschrijven en bewaart geldige data bij fouten', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'fay-commands-'));
  assert.ok(directory.startsWith(join(tmpdir(), 'fay-commands-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'commands.json');
  const store = await loadCommandStore(path);
  const first = store.snapshot();
  const [saved, conflict] = await Promise.allSettled([
    store.save({ ...first, commands: [command()] }),
    store.save({ ...first, commands: [] })
  ]);
  assert.equal(saved.status, 'fulfilled');
  assert.equal(conflict.status, 'rejected');
  const restarted = await loadCommandStore(path);
  assert.equal(restarted.snapshot().revision, 1);
  assert.deepEqual(restarted.snapshot().commands, [command()]);
  const before = await readFile(path, 'utf8');
  assert.throws(() => store.save({ revision: 1, commands: [{ ...command(), cooldownSeconds: -1 }] }));
  assert.equal(await readFile(path, 'utf8'), before);
  const blockedPath = join(directory, 'file');
  await writeFile(blockedPath, 'geen directory');
  const blocked = createCommandStore(join(blockedPath, 'commands.json'));
  await assert.rejects(blocked.save({ revision: 0, commands: [] }));
  assert.equal(blocked.snapshot().revision, 0);
  await writeFile(path, '{kapot');
  await assert.rejects(loadCommandStore(path), /Herstel dit bestand/);
});

test('commandowijzigingen gelden direct en stoppen een al gestarte antwoordreeks', async () => {
  const store = createCommandStore(undefined, { revision: 0, commands: [command()] });
  const sent: string[] = [];
  let now = 10_000;
  let disableDuringWait = false;
  const process = createCommands({
    send: async text => { sent.push(text); }, active: () => true, botUsername: 'bot', report: assert.fail,
    getCommands: () => store.list(), now: () => now,
    wait: async ms => {
      now += ms;
      if (disableDuringWait) {
        disableDuringWait = false;
        await store.save({ ...store.snapshot(), commands: [{ ...command(), enabled: false }] });
      }
    }
  });
  await process({ content: ' !TEST ' });
  assert.deepEqual(sent, ['Eerste', 'Tweede']);
  await process({ content: '!test' });
  assert.equal(sent.length, 2);
  now += 5000;
  await store.save({ ...store.snapshot(), commands: [{ ...command(), responses: ['Gewijzigd'] }] });
  await process({ content: '!test' });
  assert.equal(sent.at(-1), 'Gewijzigd');
  now += 5000;
  disableDuringWait = true;
  await process({ content: '!test' });
  assert.equal(sent.length, 3);
  now += 5000;
  await process({ content: '!test' });
  assert.equal(sent.length, 3);
});

test('commands-API beschermt writes en geeft validatiefouten en revisieconflicten terug', async t => {
  const config = readConfig({});
  const app = createApp(config);
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  config.port = (app.server.address() as AddressInfo).port;
  t.after(() => app.close());
  const base = `http://127.0.0.1:${config.port}`;
  const fetch = authenticatedFetch(await signIn(config));
  const url = base + '/api/commands';
  const initial = await (await fetch(url)).json();
  assert.equal(initial.botEnabled, false);
  assert.equal(initial.commands.length, 3);
  const post = (body: unknown, extra: Record<string, string> = {}) => fetch(url, {
    method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', 'X-Requested-With': 'faynominaal', ...extra },
    body: JSON.stringify(body)
  });
  assert.equal((await fetch(url, { method: 'POST' })).status, 403);
  assert.equal((await post(initial, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await post(initial, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await post({ revision: 0, commands: [{ ...command(), responses: [] }] })).status, 400);
  const saved = await post({ revision: 0, commands: [command()] });
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).revision, 1);
  assert.equal((await post(initial)).status, 409);
  assert.equal((await post({ blob: 'x'.repeat(130 * 1024) })).status, 413);
  assert.equal((await (await fetch(url)).json()).commands[0].trigger, '!test');
});
