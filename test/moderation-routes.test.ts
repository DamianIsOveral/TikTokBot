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

async function fixture(t: { after(fn: () => unknown): void }, audit: AuditStore = createAuditStore(), moderator = false) {
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
      if (init?.method === 'POST') { writes++; return Response.json({ status_code: 0 }); }
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
