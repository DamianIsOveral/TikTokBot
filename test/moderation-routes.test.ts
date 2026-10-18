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
  class Fake extends EventEmitter {
    roomId = '7300000000000000001';
    constructor() { super(); connection = this; }
    async connect() {}
    async disconnect() {}
    async sendMessage() { assert.fail('Geen chatbericht in moderatietest.'); }
  }
  const access = createAccessStore([ADMIN], undefined, { revision: 0, users: [{ id: MEMBER, role: 'member' }] });
  const app = createTestApp(config, async () => ({ TikTokLiveConnection: Fake }), undefined, access, undefined, {
    createSigner: async () => async input => ({ signedUrl: input.url + '&X-Dynosaur=x&msToken=PRIVATE_TOKEN&X-Bogus=x&X-Gnarly=x', signMs: 1, rssMiB: 64 }),
    request: async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.includes('/account/info/')) return Response.json({ data: { username: config.botUsername, user_id: 123, user_id_str: '123' } });
      if (init?.method === 'HEAD') return new Response(null);
      if (init?.method === 'POST') {
        writes++;
        if (outcome === 'uncertain') throw new Error('Network failure');
        return Response.json({ status_code: outcome === 'rejected' ? 403 : 0 });
      }
      if (url.pathname.endsWith('/list/')) return Response.json({ status_code: 0, data: [], extra: { has_more: false } });
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
  return { config, app, request, cookie, base, headers, audit, writes: () => writes,
    chat(id = '456', secUid = 'SEC_VIEWER') {
      connection.emit('chat', { content: 'Bericht', user: { displayId: 'viewer', id, idStr: '', secUid } });
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

test('recorded mute fallback retains protected owner and bot target checks', async t => {
  for (const targetId of ['999', '123']) {
    await t.test(targetId, async t => {
      const audit = createAuditStore();
      const pending = await audit.begin({ actor: { id: ADMIN, name: 'Moderator' }, target: { id: targetId, name: 'Protected' },
        roomId: '7300000000000000001', action: 'mute', duration: 0 });
      await audit.finish(pending.id, 'accepted');
      const f = await fixture(t, audit);
      await f.connect();
      f.chat(targetId, 'SEC_PROTECTED');
      const response = await f.request(f.base + '/api/moderation', { method: 'POST', headers: f.headers,
        body: JSON.stringify({ action: 'unmute', targetId }) });
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
