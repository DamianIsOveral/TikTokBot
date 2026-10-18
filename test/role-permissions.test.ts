import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { TestContext } from 'node:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readConfig } from '../src/server/config.ts';
import { createAccessStore, loadAccessStore } from '../src/server/auth/access-store.ts';
import { createCommandStore } from '../src/server/command-store.ts';
import { createFilterStore } from '../src/server/filter-store.ts';
import { ADMIN, MEMBER, authenticatedFetch, createTestApp, signIn } from './auth-fixture.ts';

const HEAD = '444444444444444444';

async function fixture(t: TestContext) {
  const config = readConfig({});
  const access = createAccessStore([ADMIN], undefined, { revision: 0, users: [
    { id: MEMBER, role: 'member' }, { id: HEAD, role: 'head-moderator' }
  ] });
  let connections = 0;
  class Fake extends EventEmitter {
    roomId = '7300000000000000001';
    constructor() { super(); }
    async connect() { connections++; }
    async disconnect() {}
    async sendMessage() { assert.fail('Role tests never send TikTok messages.'); }
  }
  const app = createTestApp(config, async () => ({ TikTokLiveConnection: Fake }), undefined, access);
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  config.port = (app.server.address() as AddressInfo).port;
  t.after(() => app.close());
  const base = `http://127.0.0.1:${config.port}`;
  const cookies = { admin: await signIn(config), member: await signIn(config, MEMBER), head: await signIn(config, HEAD) };
  const users = { admin: authenticatedFetch(cookies.admin), member: authenticatedFetch(cookies.member), head: authenticatedFetch(cookies.head) };
  const headers = { Origin: base, 'Content-Type': 'application/json', 'X-Requested-With': 'faynominaal' };
  const post = (user: typeof fetch, path: string, body: unknown = {}) => user(base + path, { method: 'POST', headers, body: JSON.stringify(body) });
  const role = async (id: string, next: 'member' | 'head-moderator') => {
    const current = access.snapshot();
    const result = await post(users.admin, '/api/access', { ...current,
      users: current.users.map(user => user.id === id ? { ...user, role: next } : user) });
    assert.equal(result.status, 200);
  };
  return { app, base, access, cookies, users, headers, post, role, connections: () => connections };
}

test('moderators read shared data but only head-moderators and admins manage it', async t => {
  const f = await fixture(t);
  const paths = ['/api/commands', '/api/filters', '/api/connect', '/api/stop', '/api/capabilities'];
  for (const path of paths) assert.equal((await fetch(f.base + path, { method: 'POST' })).status, 401, path);
  for (const user of Object.values(f.users)) {
    for (const path of ['/api/commands', '/api/filters', '/api/snapshot', '/api/moderation', '/api/moderation/audit', '/api/capabilities']) {
      assert.equal((await user(f.base + path)).status, 200, path);
    }
  }
  for (const path of paths) assert.equal((await f.post(f.users.member, path)).status, 403, path);
  assert.equal(f.connections(), 0);
  for (const user of [f.users.head, f.users.admin]) {
    for (const path of ['/api/commands', '/api/filters']) {
      const current = await (await user(f.base + path)).json();
      const body = path.endsWith('commands') ? { revision: current.revision, commands: current.commands, limits: current.limits } : current;
      assert.equal((await f.post(user, path, body)).status, 200, path);
      assert.equal((await user(f.base + path, { method: 'POST' })).status, 403, 'CSRF remains required');
    }
    assert.equal((await f.post(user, '/api/connect')).status, 202);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal((await f.post(user, '/api/stop')).status, 202);
    assert.equal((await f.post(user, '/api/capabilities')).status, 200);
  }
  assert.equal(f.connections(), 2);
  for (const path of ['/api/access', '/api/bot-session']) {
    assert.equal((await f.users.head(f.base + path)).status, 403, path);
    assert.equal((await f.post(f.users.head, path)).status, 403, path);
  }
  assert.equal((await f.post(f.users.head, '/api/branding', { revision: 0, icon: null })).status, 403);
  assert.equal((await f.post(f.users.admin, '/api/branding', { revision: 0, icon: null })).status, 200);
});

test('legacy members retain their role and head-moderator roles persist without changing fixed admins', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'fay-roles-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'access.json');
  const store = createAccessStore([ADMIN], path, { revision: 0, users: [{ id: MEMBER, role: 'member' }] });
  await store.save({ ...store.snapshot(), users: [...store.snapshot().users, { id: HEAD, role: 'head-moderator' }] });
  const loaded = await loadAccessStore(path, [ADMIN]);
  assert.equal(loaded.role(MEMBER), 'member');
  assert.equal(loaded.role(HEAD), 'head-moderator');
  assert.equal(loaded.role(ADMIN), 'admin');
  assert.throws(() => loaded.save({ ...loaded.snapshot(), users: [{ id: ADMIN, role: 'head-moderator' }] }), /Vaste beheerders/);
  assert.throws(() => loaded.save({ ...loaded.snapshot(), users: [...loaded.snapshot().users, { id: '555555555555555555', role: 'owner' }] }), /gebruikersrol/);
});

test('role changes take effect within an existing session, including delayed upload bodies', { timeout: 10_000 }, async t => {
  const f = await fixture(t);
  for (const path of ['/api/commands', '/api/filters']) {
    await f.role(HEAD, 'head-moderator');
    const current = await (await f.users.head(f.base + path)).json();
    const body = JSON.stringify(path.endsWith('commands') ? { revision: current.revision, commands: current.commands } : current);
    let ready!: () => void;
    const started = new Promise<void>(resolve => { ready = resolve; });
    const observe = (request: http.IncomingMessage) => {
      if (request.url === path && request.method === 'POST') ready();
    };
    f.app.server.on('request', observe);
    const result = new Promise<number>((resolve, reject) => {
      const request = http.request(f.base + path, { method: 'POST', headers: { ...f.headers, Cookie: f.cookies.head,
        'Content-Length': Buffer.byteLength(body) } }, response => {
        response.resume(); response.on('end', () => resolve(response.statusCode!));
      });
      request.on('error', reject);
      request.flushHeaders();
      void started.then(async () => {
        await new Promise<void>(done => setImmediate(done));
        await f.role(HEAD, 'member');
        request.end(body);
      }).catch(reject);
    });
    assert.equal(await result, 403, path);
    f.app.server.off('request', observe);
    assert.equal((await (await f.users.head(f.base + path)).json()).revision, current.revision);
    assert.equal((await (await f.users.head(f.base + '/auth/session')).json()).user.role, 'member');
  }
  for (const path of ['/api/connect', '/api/stop', '/api/capabilities']) assert.equal((await f.post(f.users.head, path)).status, 403);
  await f.role(HEAD, 'head-moderator');
  assert.equal((await f.post(f.users.head, '/api/stop')).status, 202);
});

test('queued command and filter writes revalidate authorization before changing persisted data', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'fay-role-writes-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const create of [createCommandStore, createFilterStore]) {
    const store = create(join(directory, create === createCommandStore ? 'commands.json' : 'filters.json'));
    const initial = store.snapshot();
    let allowed = true;
    let checks = 0;
    const rejected = store.save(initial, () => { checks++; return allowed; });
    assert.equal(checks, 0);
    allowed = false;
    await assert.rejects(rejected, (error: { status: number }) => error.status === 403);
    assert.deepEqual(store.snapshot(), initial);
    checks = 0;
    await assert.rejects(store.save(initial, () => ++checks === 1), (error: { status: number }) => error.status === 403);
    assert.equal(checks, 2);
    assert.deepEqual(store.snapshot(), initial);
    assert.deepEqual(await readdir(directory), []);
    assert.equal((await store.save(initial)).revision, 1);
    await rm(join(directory, create === createCommandStore ? 'commands.json' : 'filters.json'));
  }
});
