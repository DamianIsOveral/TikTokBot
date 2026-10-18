import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { AddressInfo } from 'node:net';
import { readConfig } from '../src/server/config.ts';
import { createTestApp, signIn, authenticatedFetch, ADMIN, MEMBER } from './auth-fixture.ts';
import { createAccessStore } from '../src/server/auth/access-store.ts';
import { createAuditStore } from '../src/server/moderation-audit.ts';
import { signingSdkVersion } from '../src/server/tiktok/signing-profile.ts';
import type { AuditStore } from '../src/shared/moderation.ts';
import http from 'node:http';

async function fixture(t: { after(fn: () => unknown): void }, audit: AuditStore = createAuditStore(), moderator = false,
  outcome: 'accepted' | 'rejected' | 'uncertain' = 'accepted') {
  const config = readConfig({ TIKTOK_CHAT_TRANSPORT: 'direct', TIKTOK_MODERATION_ENABLED: 'true', EULER_API_KEY: 'PRIVATE_KEY',
    TIKTOK_SESSION_ID: 'PRIVATE_SESSION', TIKTOK_TARGET_IDC: 'test', TIKTOK_MS_TOKEN: 'PRIVATE_TOKEN', TIKTOK_VERIFY_FP: 'verify_PRIVATE' });
  let connection!: Fake;
  let writes = 0;
  let lists = 0;
  let restoreSigning: (() => Promise<void>) | undefined;
  const outcomes = { mute: outcome, ban: outcome };
  const posts: { path: string; body: string }[] = [];
  let listedUsers: { id_str: string; sec_uid: string; nickname: string }[] = [];
  class Fake extends EventEmitter {
    roomId = '7300000000000000001';
    constructor() { super(); connection = this; }
    async connect() {}
    async disconnect() {}
    async sendMessage() { assert.fail('Geen chatbericht in moderatietest.'); }
  }
  const access = createAccessStore([ADMIN], undefined, { revision: 0, users: [{ id: MEMBER, role: 'member' }] });
  const app = createTestApp(config, async () => ({ TikTokLiveConnection: Fake }), undefined, access, undefined, {
    createSigner: async () => async input => {
      if (/\/(unsilence|unkick\/user)\//.test(new URL(input.url).pathname)) await restoreSigning?.();
      return { signedUrl: input.url + '&X-Dynosaur=x&msToken=PRIVATE_TOKEN&X-Bogus=x&X-Gnarly=x', signMs: 1, rssMiB: 64 };
    },
    request: async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.includes('/account/info/')) return Response.json({ data: { username: config.botUsername, user_id: 123, user_id_str: '123' } });
      if (init?.method === 'HEAD') return new Response(null);
      if (init?.method === 'POST') {
        writes++;
        posts.push({ path: url.pathname, body: String(init.body) });
        const result = url.pathname.includes('/kick/user/') ? outcomes.ban : outcomes.mute;
        if (result === 'uncertain') throw new Error('Network failure');
        return Response.json({ status_code: result === 'rejected' ? 403 : 0 });
      }
      if (url.pathname.endsWith('/list/')) {
        lists++;
        return Response.json({ status_code: 0, data: listedUsers, extra: { has_more: false } });
      }
      if (url.hostname === 'webcast.tiktok.com') {
        const id = url.searchParams.get('target_uid') || '123';
        return Response.json({ status_code: 0, data: { user: { id_str: id,
          user_attr: { is_admin: id === '123', admin_permissions: { '2': 1, '3': 1 } } } } });
      }
      const scope = url.pathname.endsWith('/live') ? { 'webapp.app-context': { csrfToken: 'PRIVATE_CSRF', wid: '123456789123456789' } }
        : { 'webapp.user-detail': { userInfo: { user: { id: '999', uniqueId: config.username, secUid: 'SEC_OWNER' } } } };
      return new Response(`<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">${JSON.stringify({ __DEFAULT_SCOPE__: scope })}</script><script src="/webmssdk/${signingSdkVersion}/webmssdk.js"></script>`);
    }
  }, audit);
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  config.port = (app.server.address() as AddressInfo).port;
  t.after(() => app.close());
  const base = `http://127.0.0.1:${config.port}`;
  const cookie = await signIn(config, moderator ? MEMBER : ADMIN);
  const request = authenticatedFetch(cookie);
  const headers = { Origin: base, 'X-Requested-With': 'faynominaal', 'Content-Type': 'application/json' };
  await request(base + '/api/capabilities');
  return { config, app, request, cookie, base, headers, audit, access, posts, writes: () => writes, lists: () => lists,
    outcome(action: 'mute' | 'ban', result: typeof outcome) { outcomes[action] = result; },
    list(users: typeof listedUsers) { listedUsers = users; },
    pauseRestore() {
      let started!: () => void;
      let release!: () => void;
      const reached = new Promise<void>(resolve => { started = resolve; });
      const gate = new Promise<void>(resolve => { release = resolve; });
      restoreSigning = async () => { started(); await gate; };
      return { reached, release };
    },
    chat(id = '456', secUid = 'SEC_VIEWER', displayName?: string, username = 'viewer') {
      connection.emit('chat', { content: 'Bericht', user: { displayId: username, nickname: displayName, id, idStr: '', secUid } });
    },
    room(value: string) { connection.roomId = value; },
    async connect() {
      const admin = moderator ? authenticatedFetch(await signIn(config)) : request;
      await admin(base + '/api/connect', { method: 'POST', headers });
      await new Promise(resolve => setImmediate(resolve));
      connection.emit('chat', { content: 'Verdacht bericht', user: { displayId: 'viewer', id:'456', idStr:'', secUid: 'SEC_VIEWER' } });
      const snapshot = await (await request(base + '/api/snapshot')).json();
      return snapshot.messages[0].id as number;
    } };
}

test('moderators behouden echte moderatieacties zonder beheerrechten', async t => {
  const f = await fixture(t, createAuditStore(), true);
  const messageId = await f.connect();
  const result = await f.request(f.base + '/api/moderation', { method: 'POST', headers: f.headers,
    body: JSON.stringify({ action: 'mute', messageId, duration: 30 }) });
  assert.equal(result.status, 200);
  assert.equal(f.writes(), 1);
  assert.equal(f.audit.list()[0].actor.id, MEMBER);
  assert.equal((await f.request(f.base + '/api/stop', { method: 'POST', headers: f.headers })).status, 403);
});

test('accepted mute survives an empty TikTok list, reload and broadcasts; trusted cached target permits unmute', { timeout: 5000 }, async t => {
  const f = await fixture(t);
  const messageId = await f.connect();
  const controller = new AbortController();
  t.after(() => controller.abort());
  const stream = await f.request(f.base + '/api/events', { signal: controller.signal });
  const reader = stream.body!.getReader();
  let buffer = '';
  async function event() {
    while (!buffer.includes('\n\n')) buffer += new TextDecoder().decode((await reader.read()).value);
    const end = buffer.indexOf('\n\n');
    const frame = buffer.slice(0, end);
    buffer = buffer.slice(end + 2);
    return JSON.parse(frame.slice('data: '.length));
  }
  assert.equal((await event()).type, 'snapshot');
  const muted = await f.request(f.base + '/api/moderation', { method: 'POST', headers: f.headers,
    body: JSON.stringify({ action: 'mute', messageId, duration: 300 }) });
  const response = await muted.json();
  assert.equal(response.accepted, true);
  assert.equal(response.moderation.entries[0].action, 'mute');
  const broadcast = await event();
  assert.equal(broadcast.type, 'moderation-changed');
  assert.deepEqual(broadcast.value.entries, response.moderation.entries);
  const listed = await (await f.request(f.base + '/api/moderation?list=muted')).json();
  assert.deepEqual(listed.list.users, []);
  assert.equal(listed.moderation.entries[0].expiresAt, Date.parse(f.audit.list()[0].at) + 300_000);
  const snapshot = await (await f.request(f.base + '/api/snapshot')).json();
  assert.deepEqual(snapshot.moderation.entries, response.moderation.entries);
  for (let index = 0; index < 510; index++) f.chat('777', 'SEC_OTHER');
  const actionTime = Date.now() + 4000;
  t.mock.method(Date, 'now', () => actionTime);
  const restored = await f.request(f.base + '/api/moderation', { method: 'POST', headers: f.headers,
    body: JSON.stringify({ action: 'unmute', targetId: '456' }) });
  assert.equal(restored.status, 200);
  const restoredState = await restored.json();
  assert.equal(restoredState.accepted, true);
  assert.equal(restoredState.moderation.entries[0].action, 'unmute');
  assert.equal(f.writes(), 2);
});

test('uncertain and rejected operations never become an active accepted mute', async t => {
  for (const outcome of ['uncertain', 'rejected'] as const) {
    await t.test(outcome, async t => {
      const f = await fixture(t, createAuditStore(), false, outcome);
      const messageId = await f.connect();
      const result = await f.request(f.base + '/api/moderation', { method: 'POST', headers: f.headers,
        body: JSON.stringify({ action: 'mute', messageId, duration: 300 }) });
      assert.ok(result.status >= 400);
      const response = await result.json();
      assert.equal(response.accepted, undefined);
      assert.equal(response.moderation.entries.length, outcome === 'uncertain' ? 1 : 0);
      if (outcome === 'uncertain') assert.equal(response.moderation.entries[0].status, 'uncertain');
      const actionTime = Date.now() + 4000;
      t.mock.method(Date, 'now', () => actionTime);
      const restored = await f.request(f.base + '/api/moderation', { method: 'POST', headers: f.headers,
        body: JSON.stringify({ action: 'unmute', targetId: '456' }) });
      assert.equal(restored.status, 409);
      assert.equal(f.writes(), 1);
    });
  }
});

test('recorded restores use accepted mute and ban identity after chat pruning without listing TikTok', async t => {
  const f = await fixture(t);
  const messageId = await f.connect();
  let actionTime = Date.now();
  t.mock.method(Date, 'now', () => actionTime);
  async function act(body: Record<string, unknown>) {
    actionTime += 4000;
    const response = await f.request(f.base + '/api/moderation', { method: 'POST', headers: f.headers, body: JSON.stringify(body) });
    assert.equal(response.status, 200, JSON.stringify(await response.json()));
  }
  await act({ action: 'ban', messageId });
  await act({ action: 'mute', messageId, duration: 300 });
  for (let index = 0; index < 510; index++) f.chat('777', 'SEC_OTHER');
  assert.ok(!(await (await f.request(f.base + '/api/snapshot')).json()).messages.some((item: { userId: string }) => item.userId === '456'));
  await act({ action: 'unmute', targetId: '456', recorded: true });
  await act({ action: 'unban', targetId: '456', recorded: true });
  assert.equal(f.lists(), 0);
  assert.equal(f.writes(), 4);
  assert.deepEqual(f.audit.list().slice(0, 2).map(item => item.action), ['unban', 'unmute']);
});

test('ordinary blocked-list restore falls back to an accepted recorded ban', async t => {
  const f = await fixture(t);
  const messageId = await f.connect();
  assert.equal((await f.request(f.base + '/api/moderation', { method: 'POST', headers: f.headers,
    body: JSON.stringify({ action: 'ban', messageId }) })).status, 200);
  const actionTime = Date.now() + 4000;
  t.mock.method(Date, 'now', () => actionTime);
  assert.equal((await f.request(f.base + '/api/moderation', { method: 'POST', headers: f.headers,
    body: JSON.stringify({ action: 'unban', targetId: '456' }) })).status, 200);
  assert.equal(f.lists(), 1);
  assert.equal(f.writes(), 2);
});

test('accepted ban alone retains its trusted restore identity after target messages are pruned', async t => {
  const f = await fixture(t);
  const messageId = await f.connect();
  assert.equal((await f.request(f.base + '/api/moderation', { method: 'POST', headers: f.headers,
    body: JSON.stringify({ action: 'ban', messageId }) })).status, 200);
  for (let index = 0; index < 510; index++) f.chat('777', 'SEC_OTHER');
  const actionTime = Date.now() + 4000;
  t.mock.method(Date, 'now', () => actionTime);
  assert.equal((await f.request(f.base + '/api/moderation', { method: 'POST', headers: f.headers,
    body: JSON.stringify({ action: 'unban', targetId: '456', recorded: true }) })).status, 200);
  assert.equal(f.lists(), 0);
  assert.equal(f.writes(), 2);
});

async function record(audit: AuditStore, action: 'mute' | 'ban' | 'unmute' | 'unban',
  status: 'accepted' | 'uncertain' = 'accepted', duration = 0, roomId = '7300000000000000001') {
  const entry = await audit.begin({ actor: { id: ADMIN, name: 'Moderator' }, target: { id: '456', name: 'Viewer' },
    action, ...(action === 'mute' ? { duration } : {}), roomId });
  await audit.finish(entry.id, status);
}

test('recorded restore rejects uncertain, reverted, expired, wrong-room and untrusted restrictions without lists', async t => {
  for (const action of ['mute', 'ban'] as const) {
    for (const state of ['uncertain', 'reverted', 'expired', 'wrong-room', 'untrusted'] as const) {
      if (action === 'ban' && state === 'expired') continue;
      await t.test(`${action}: ${state}`, async t => {
        const audit = createAuditStore(undefined, [], () => new Date(Date.now() - (state === 'expired' ? 10_000 : 0)));
        await record(audit, action, state === 'uncertain' ? 'uncertain' : 'accepted', state === 'expired' ? 5 : 0,
          state === 'wrong-room' ? '7300000000000000002' : '7300000000000000001');
        if (state === 'reverted') await record(audit, action === 'mute' ? 'unmute' : 'unban');
        const f = await fixture(t, audit);
        await f.connect();
        if (state === 'untrusted') for (let index = 0; index < 510; index++) f.chat('777', 'SEC_OTHER');
        const response = await f.request(f.base + '/api/moderation', { method: 'POST', headers: f.headers,
          body: JSON.stringify({ action: action === 'mute' ? 'unmute' : 'unban', targetId: '456', recorded: true }) });
        assert.equal(response.status, 409);
        assert.equal(f.lists(), 0);
        assert.equal(f.writes(), 0);
      });
    }
  }
});

test('recorded restore rechecks state, room, expiry and Discord authorization immediately before sending', async t => {
  for (const change of ['uncertain', 'reverted', 'room', 'expiry', 'authorization'] as const) {
    await t.test(change, async t => {
      const audit = createAuditStore();
      await record(audit, 'mute', 'accepted', change === 'expiry' ? 5 : 0);
      const f = await fixture(t, audit, change === 'authorization');
      await f.connect();
      const pause = f.pauseRestore();
      const pending = f.request(f.base + '/api/moderation', { method: 'POST', headers: f.headers,
        body: JSON.stringify({ action: 'unmute', targetId: '456', recorded: true }) });
      await pause.reached;
      if (change === 'uncertain') await record(audit, 'mute', 'uncertain');
      else if (change === 'reverted') await record(audit, 'unmute');
      else if (change === 'room') f.room('7300000000000000002');
      else if (change === 'expiry') {
        const actionTime = Date.now() + 6000;
        t.mock.method(Date, 'now', () => actionTime);
      } else await f.access.save({ revision: 0, users: [{ id: ADMIN, role: 'admin' }] });
      pause.release();
      assert.equal((await pending).status, 502);
      assert.equal(f.writes(), 0);
      assert.equal(f.lists(), 0);
    });
  }
});

test('recorded restore validates its flag and refuses supplied target credentials', async t => {
  const f = await fixture(t);
  const messageId = await f.connect();
  for (const body of [
    { action: 'unban', targetId: '456', recorded: 'true' },
    { action: 'ban', messageId, recorded: true },
    { action: 'unmute', targetId: '456', recorded: true, secUid: 'FORGED' }
  ]) {
    assert.equal((await f.request(f.base + '/api/moderation', { method: 'POST', headers: f.headers,
      body: JSON.stringify(body) })).status, 400);
  }
  assert.equal(f.writes(), 0);
  assert.equal(f.lists(), 0);
});

test('combined action captures one trusted target, performs mute then ban and stores both accepted axes', async t => {
  const f = await fixture(t);
  await f.connect();
  f.chat('456', 'SEC_VIEWER', 'Viewer display name');
  const snapshot = await (await f.request(f.base + '/api/snapshot')).json();
  const messageId = snapshot.messages.at(-1).id;
  const response = await f.request(f.base + '/api/moderation', { method: 'POST', headers: f.headers,
    body: JSON.stringify({ action: 'mute-ban', messageId, duration: 300 }) });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.accepted, true);
  assert.deepEqual(result.moderation.entries.map((item: { action: string }) => item.action).sort(), ['ban', 'mute']);
  assert.ok(result.moderation.entries.every((item: { displayName: string }) => item.displayName === 'Viewer display name'));
  assert.deepEqual(f.audit.list().map(item => [item.action, item.status, item.target]), [
    ['ban', 'accepted', { id: '456', name: 'viewer', displayName: 'Viewer display name' }],
    ['mute', 'accepted', { id: '456', name: 'viewer', displayName: 'Viewer display name' }]
  ]);
  assert.deepEqual(f.posts.map(item => item.path), ['/webcast/room/silence/', '/webcast/room/kick/user/']);
  assert.equal(JSON.parse(f.posts[0].body).user_id, '456');
  assert.equal(JSON.parse(f.posts[1].body).kick_uid, '456');
  assert.equal((await f.request(f.base + '/api/moderation', { method: 'POST', headers: f.headers,
    body: JSON.stringify({ action: 'mute', messageId, duration: 300 }) })).status, 429);
  assert.equal(f.lists(), 0);
});

test('combined action stops after a failed mute without attempting a block', async t => {
  for (const outcome of ['rejected', 'uncertain'] as const) await t.test(outcome, async t => {
    const f = await fixture(t, createAuditStore(), false, outcome);
    const messageId = await f.connect();
    const response = await f.request(f.base + '/api/moderation', { method: 'POST', headers: f.headers,
      body: JSON.stringify({ action: 'mute-ban', messageId, duration: 300 }) });
    assert.equal(response.status, 502);
    const result = await response.json();
    assert.equal(result.partial, undefined);
    assert.equal(result.accepted, undefined);
    assert.deepEqual(f.audit.list().map(item => [item.action, item.status]), [['mute', outcome]]);
    assert.equal(f.writes(), 1);
  });
});

test('combined action exposes partial block failures and preserves accepted mute cache after message pruning', async t => {
  for (const outcome of ['rejected', 'uncertain'] as const) await t.test(outcome, async t => {
    const f = await fixture(t);
    const messageId = await f.connect();
    f.outcome('ban', outcome);
    const response = await f.request(f.base + '/api/moderation', { method: 'POST', headers: f.headers,
      body: JSON.stringify({ action: 'mute-ban', messageId, duration: 300 }) });
    assert.equal(response.status, 502);
    const result = await response.json();
    assert.equal(result.partial, true);
    assert.deepEqual(result.completed, ['mute']);
    assert.match(result.error, /Demping.*geaccepteerd; blokkeren is niet bevestigd/);
    assert.deepEqual(f.audit.list().map(item => [item.action, item.status]), [['ban', outcome], ['mute', 'accepted']]);
    assert.equal(result.moderation.entries.find((item: { action: string }) => item.action === 'mute').status, 'accepted');
    for (let index = 0; index < 510; index++) f.chat('777', 'SEC_OTHER');
    const actionTime = Date.now() + 4000;
    t.mock.method(Date, 'now', () => actionTime);
    assert.equal((await f.request(f.base + '/api/moderation', { method: 'POST', headers: f.headers,
      body: JSON.stringify({ action: 'unmute', targetId: '456', recorded: true }) })).status, 200);
    assert.equal(f.writes(), 3);
    assert.equal(f.lists(), 0);
  });
});

test('combined action preserves its captured target and rechecks room and authorization between mute and ban', async t => {
  for (const change of ['identity', 'room', 'authorization'] as const) await t.test(change, async t => {
    const store = createAuditStore();
    let changeAfterMute: (() => Promise<void>) | undefined;
    const audit: AuditStore = { ...store, async finish(id, status, reason) {
      const result = await store.finish(id, status, reason);
      if (result.action === 'mute' && status === 'accepted') await changeAfterMute?.();
      return result;
    } };
    const f = await fixture(t, audit, change === 'authorization');
    const messageId = await f.connect();
    changeAfterMute = async () => {
      f.chat('777', 'SEC_CHANGED');
      if (change === 'room') f.room('7300000000000000002');
      else if (change === 'authorization') await f.access.save({ revision: 0, users: [{ id: ADMIN, role: 'admin' }] });
    };
    const response = await f.request(f.base + '/api/moderation', { method: 'POST', headers: f.headers,
      body: JSON.stringify({ action: 'mute-ban', messageId, duration: 300 }) });
    assert.equal(response.status, change === 'identity' ? 200 : 502);
    const result = await response.json();
    if (change === 'identity') {
      assert.equal(result.accepted, true);
      assert.equal(f.writes(), 2);
      assert.equal(JSON.parse(f.posts[1].body).kick_uid, '456');
    } else {
      assert.equal(result.partial, true);
      assert.equal(f.writes(), 1);
      assert.deepEqual(audit.list().map(item => [item.action, item.status]), [['mute', 'accepted']]);
    }
  });
});

test('remote moderation names are enriched from trusted matching IDs without matching nickname text', async t => {
  const f = await fixture(t);
  await f.connect();
  f.chat('456', 'SEC_VIEWER', 'Visible viewer', 'canonical_viewer');
  f.list([{ id_str: '456', sec_uid: 'SEC_VIEWER', nickname: 'different_remote_name' },
    { id_str: '777', sec_uid: 'SEC_OTHER', nickname: 'canonical_viewer' }]);
  let response = await (await f.request(f.base + '/api/moderation?list=blocked')).json();
  assert.deepEqual(response.list.users, [
    { userId: '456', secUid: 'SEC_VIEWER', name: 'different_remote_name', username: 'canonical_viewer', displayName: 'Visible viewer' },
    { userId: '777', secUid: 'SEC_OTHER', name: 'canonical_viewer' }
  ]);
  const snapshot = await (await f.request(f.base + '/api/snapshot')).json();
  const messageId = snapshot.messages.at(-1).id;
  assert.equal((await f.request(f.base + '/api/moderation', { method: 'POST', headers: f.headers,
    body: JSON.stringify({ action: 'ban', messageId }) })).status, 200);
  for (let index = 0; index < 510; index++) f.chat('888', 'SEC_PRUNER');
  response = await (await f.request(f.base + '/api/moderation?list=blocked')).json();
  assert.equal(response.list.users[0].username, 'canonical_viewer');
  assert.equal(response.list.users[0].displayName, 'Visible viewer');
  assert.equal(f.lists(), 2);
});

test('persisted mute without trusted target data cannot authorize arbitrary restore or cross-room actions', async t => {
  const audit = createAuditStore();
  const pending = await audit.begin({ actor: { id: ADMIN, name: 'Moderator' }, target: { id: '888', name: 'Stored viewer' },
    roomId: '7300000000000000001', action: 'mute', duration: 0 });
  await audit.finish(pending.id, 'accepted');
  const f = await fixture(t, audit);
  await f.connect();
  const result = await f.request(f.base + '/api/moderation', { method: 'POST', headers: f.headers,
    body: JSON.stringify({ action: 'unmute', targetId: '888' }) });
  assert.equal(result.status, 409);
  assert.match((await result.json()).error, /vertrouwde gebruikersgegevens/);
  assert.equal(f.writes(), 0);
  const actionTime = Date.now() + 4000;
  t.mock.method(Date, 'now', () => actionTime);
  f.room('7300000000000000002');
  const state = await (await f.request(f.base + '/api/moderation')).json();
  assert.deepEqual(state.moderation.entries, []);
  const crossRoom = await f.request(f.base + '/api/moderation', { method: 'POST', headers: f.headers,
    body: JSON.stringify({ action: 'unmute', targetId: '888' }) });
  assert.equal(crossRoom.status, 409);
  assert.equal(f.writes(), 0);
});

test('failed audit completion never exposes accepted feedback after a successful TikTok response', async t => {
  const store = createAuditStore();
  const audit: AuditStore = { ...store, finish: async () => { throw new Error('Disk full'); } };
  const f = await fixture(t, audit);
  const messageId = await f.connect();
  const result = await f.request(f.base + '/api/moderation', { method: 'POST', headers: f.headers,
    body: JSON.stringify({ action: 'mute', messageId, duration: 300 }) });
  assert.equal(result.status, 503);
  const response = await result.json();
  assert.equal(response.accepted, undefined);
  assert.deepEqual(response.moderation.entries, []);
  assert.equal(audit.list()[0].status, 'pending');
  assert.equal(f.writes(), 1);
});

test('recorded restores retain protected owner and bot target checks', async t => {
  for (const action of ['mute', 'ban'] as const) for (const targetId of ['999', '123']) {
    await t.test(`${action}: ${targetId}`, async t => {
      const audit = createAuditStore();
      const pending = await audit.begin({ actor: { id: ADMIN, name: 'Moderator' }, target: { id: targetId, name: 'Protected' },
        roomId: '7300000000000000001', action, ...(action === 'mute' ? { duration: 0 } : {}) });
      await audit.finish(pending.id, 'accepted');
      const f = await fixture(t, audit);
      await f.connect();
      f.chat(targetId, 'SEC_PROTECTED');
      const response = await f.request(f.base + '/api/moderation', { method: 'POST', headers: f.headers,
        body: JSON.stringify({ action: action === 'mute' ? 'unmute' : 'unban', targetId, recorded: true }) });
      assert.equal(response.status, 403);
      assert.equal(f.writes(), 0);
    });
  }
});

test('audit en moderatie vereisen Discord; offline audit blijft leesbaar voor toegelaten gebruikers', async t => {
  const f = await fixture(t);
  for (const path of ['/api/moderation', '/api/moderation/audit']) assert.equal((await fetch(f.base + path)).status, 401);
  const state = await (await f.request(f.base + '/api/moderation')).json();
  assert.equal(state.connected, false);
  assert.deepEqual(await (await f.request(f.base + '/api/moderation/audit')).json(), { entries: [] });
});

test('moderatie legt de echte Discordactor en het serverdoel vast; actorinjectie wordt geweigerd', async t => {
  const f = await fixture(t);
  const messageId = await f.connect();
  const forged = await f.request(f.base + '/api/moderation', { method: 'POST', headers: f.headers,
    body: JSON.stringify({ action: 'mute', messageId, duration: 30, actor: { id: 'forged' } }) });
  assert.equal(forged.status, 400);
  assert.equal(f.writes(), 0);
  const result = await f.request(f.base + '/api/moderation', { method: 'POST', headers: f.headers,
    body: JSON.stringify({ action: 'mute', messageId, duration: 30 }) });
  assert.equal(result.status, 200);
  assert.equal(f.writes(), 1);
  const [entry] = f.audit.list();
  assert.equal(entry.actor.id, ADMIN);
  assert.equal(entry.target.id, '456');
  assert.equal(entry.action, 'mute');
  assert.equal(entry.status, 'accepted');
  assert.ok(!/PRIVATE|SEC_VIEWER|forged/.test(JSON.stringify(entry)));
});

test('niet-schrijfbaar moderatielog verhindert de TikTokactie', async t => {
  const audit: AuditStore = { list: () => [], begin: async () => { throw new Error('Disk full'); }, finish: async () => { throw new Error(); } };
  const f = await fixture(t, audit);
  const messageId = await f.connect();
  const result = await f.request(f.base + '/api/moderation', { method: 'POST', headers: f.headers,
    body: JSON.stringify({ action: 'mute', messageId, duration: 30 }) });
  assert.equal(result.status, 503);
  assert.equal(f.writes(), 0);
  assert.ok(!(await result.text()).includes('Disk full'));
});

test('gelijktijdige moderatie met vertraagde bodies kan de gedeelde actiepauze niet omzeilen', {timeout:5000},async t=>{
  const f=await fixture(t);
  const messageId=await f.connect();
  const payload=JSON.stringify({action:'mute',messageId,duration:30});
  let count=0;
  let ready!:()=>void;
  const both=new Promise<void>(resolve=>{ready=resolve;});
  f.app.server.on('request',req=>{if(req.url==='/api/moderation'&&req.method==='POST'&&++count===2)ready();});
  function slow(cookie:string) {
    let finish!: (value:number)=>void;
    const response=new Promise<number>(resolve=>{finish=resolve;});
    const request=http.request(f.base+'/api/moderation',{method:'POST',headers:{...f.headers,Cookie:cookie,'Content-Length':Buffer.byteLength(payload)}},res=>{
      res.resume();res.once('end',()=>finish(res.statusCode!));
    });
    request.flushHeaders();
    return {request,response};
  }
  const a=slow(f.cookie),b=slow(await signIn(f.config));
  await both;await new Promise<void>(resolve=>setImmediate(resolve));
  a.request.end(payload);b.request.end(payload);
  assert.deepEqual((await Promise.all([a.response,b.response])).sort(),[200,429]);
  assert.equal(f.writes(),1);assert.equal(f.audit.list().length,1);
});
