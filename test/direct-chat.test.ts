import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { AddressInfo } from 'node:net';
import { readConfig } from '../src/server/config.ts';
import { createDirectChat } from '../src/server/tiktok/direct-chat.ts';
import { DirectTikTokError } from '../src/server/tiktok/direct-client.ts';
import { messageErrorText } from '../src/server/message-errors.ts';
import { signingSdkVersion } from '../src/server/tiktok/signing-profile.ts';
import type { DirectRequestSigner } from '../src/server/tiktok/signing-profile.ts';
import { createCommandStore } from '../src/server/command-store.ts';
import { createTestApp, signIn, authenticatedFetch } from './auth-fixture.ts';

const env = { BOT_ENABLED: 'true', TIKTOK_CHAT_TRANSPORT: 'direct', EULER_API_KEY: 'PRIVATE_KEY',
  TIKTOK_SESSION_ID: 'PRIVATE_SESSION', TIKTOK_TARGET_IDC: 'test-idc', TIKTOK_MS_TOKEN: 'PRIVATE_TOKEN', TIKTOK_VERIFY_FP: 'verify_PRIVATE_FP' };
const credentials = readConfig(env).directCredentials!;
const suffix = '&X-Dynosaur=fake&msToken=PRIVATE_TOKEN&X-Bogus=fake&X-Gnarly=fake';
const fakeSigner: DirectRequestSigner = async input => ({ signedUrl: input.url + suffix, signMs: 1, rssMiB: 64 });

function transport(onPost: (input: RequestInit) => Response = () => Response.json({ status_code: 0 })) {
  const methods: string[] = [];
  const request: typeof fetch = async (input, init) => {
    methods.push(init?.method || 'GET');
    if (String(input).includes('/account/info/')) return Response.json({ data: { username: credentials.botUsername, user_id: '123' } });
    if (init?.method === 'HEAD') return new Response(null);
    if (init?.method === 'POST') return onPost(init);
    return new Response(`<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">${JSON.stringify({
      __DEFAULT_SCOPE__: { 'webapp.app-context': { csrfToken: 'PRIVATE_CSRF', wid: '123456789123456789' } }
    })}</script><script src="/webmssdk/${signingSdkVersion}/webmssdk.js"></script>`);
  };
  return { request, methods };
}

test('directe transportkeuze vereist complete botcontext en accepteert geen onbekende modus', () => {
  assert.equal(readConfig({}).chatTransport, 'euler');
  assert.equal(readConfig(env).chatTransport, 'direct');
  assert.throws(() => readConfig({ ...env, TIKTOK_CHAT_TRANSPORT: 'automatic' }));
  for (const key of ['TIKTOK_MS_TOKEN', 'TIKTOK_VERIFY_FP', 'TIKTOK_SESSION_ID', 'TIKTOK_TARGET_IDC']) {
    assert.throws(() => readConfig({ ...env, [key]: '' }));
  }
});

test('directe rechtencontrole controleert botidentiteit zonder berichten en verloopt na vijf minuten', async () => {
  let time = Date.now();
  let signerStarts = 0;
  const fake = transport();
  const service = createDirectChat(credentials, 'streamer', () => {}, { request: fake.request,
    createSigner: async () => { signerStarts++; return fakeSigner; }, now: () => time });
  assert.equal(service.canSend(), false);
  const [first, second] = await Promise.all([service.refresh(), service.refresh()]);
  assert.deepEqual(first, second);
  assert.equal(first.chat, true);
  assert.equal(first.moderation, false);
  assert.deepEqual(fake.methods, ['GET']);
  assert.ok(!/PRIVATE|https:/.test(JSON.stringify(first)));
  time += 300_000;
  assert.equal(service.canSend(), false);
  await service.refresh();
  assert.equal(service.canSend(), true);
  assert.equal(signerStarts, 1);
  assert.deepEqual(fake.methods, ['GET', 'GET']);
  service.close();
  assert.equal(service.canSend(), false);
  await service.refresh(true);
  assert.equal(fake.methods.length, 2);
});

test('verkeerd botaccount en onbeschikbare signer houden directe commands geblokkeerd', async () => {
  for (const failSigner of [false, true]) {
    const service = createDirectChat(credentials, 'streamer', () => {}, {
      request: async () => Response.json({ data: { username: 'wrong_account', user_id: '123' } }),
      createSigner: async () => { if (failSigner) throw new Error('PRIVATE_TOKEN'); return fakeSigner; }
    });
    const result = await service.refresh();
    assert.equal(result.chat, false);
    assert.equal(result.moderation, false);
    assert.ok(!JSON.stringify(result).includes('PRIVATE'));
    await assert.rejects(service.send('Test', '7300000000000000001', () => true));
    service.close();
  }
});

test('periodieke identiteitscontrole bewaart ontvangen bot-tokenrotatie en houdt signer/cookie/query gelijk', async () => {
  let time = Date.now();
  let calls = 0;
  const fake = transport(init => {
    assert.match(new Headers(init.headers).get('Cookie') || '', /msToken=ROTATED_TOKEN/);
    return Response.json({ status_code: 0 });
  });
  const service = createDirectChat(credentials, 'streamer', () => {}, {
    now: () => time, request: async (input, init) => {
      if (String(input).includes('/account/info/') && ++calls === 1) return Response.json({
        data: { username: credentials.botUsername, user_id: '123' }
      }, { headers: { 'Set-Cookie': 'msToken=ROTATED_TOKEN; Max-Age=600; Secure' } });
      return fake.request(input, init);
    }, createSigner: async () => async input => {
      assert.equal(input.msToken, 'ROTATED_TOKEN');
      return { signedUrl: input.url + suffix.replace('PRIVATE_TOKEN', input.msToken), signMs: 1, rssMiB: 64 };
    }
  });
  await service.refresh();
  time += 300_000;
  await service.refresh();
  await service.send('Test', '7300000000000000001', () => true);
  service.close();
});

test('stop tijdens ondertekenen blokkeert de POST vóór transport', async () => {
  let active = true;
  const fake = transport();
  const service = createDirectChat(credentials, 'streamer', () => {}, { request: fake.request,
    createSigner: async () => async input => { active = false; return fakeSigner(input); } });
  await service.refresh();
  await assert.rejects(service.send('Test', '7300000000000000001', () => active), error => {
    assert.ok(error instanceof DirectTikTokError);
    assert.equal(error.kind, 'inactive');
    return true;
  });
  assert.deepEqual(fake.methods, ['GET', 'GET', 'HEAD']);
  service.close();
});

test('een door TikTok verwijderde msToken blokkeert de POST vóór transport', async () => {
  const fake = transport();
  const service = createDirectChat(credentials, 'streamer', () => {}, {
    createSigner: async () => fakeSigner, request: async (input, init) => init?.method === 'HEAD'
      ? new Response(null, { headers: { 'Set-Cookie': 'msToken=; Max-Age=0; Secure' } }) : fake.request(input, init)
  });
  await service.refresh();
  await assert.rejects(service.send('Test', '7300000000000000001', () => true), error => {
    assert.ok(error instanceof DirectTikTokError);
    assert.equal(error.kind, 'signing-context');
    return true;
  });
  assert.equal(fake.methods.includes('POST'), false);
  assert.equal(service.canSend(), false);
  service.close();
});

test('een geweigerd bericht pauzeert verzending, ook als een oudere hercontrole nog loopt', async () => {
  let time = Date.now();
  let release!: () => void;
  let identityCalls = 0;
  const fake = transport(() => new Response('PRIVATE_TOKEN', { status: 403 }));
  const service = createDirectChat(credentials, 'streamer', () => {}, {
    now: () => time, createSigner: async () => fakeSigner, request: async (input, init) => {
      if (String(input).includes('/account/info/') && ++identityCalls === 2) await new Promise<void>(resolve => { release = resolve; });
      return fake.request(input, init);
    }
  });
  await service.refresh();
  time += 31_000;
  const rechecking = service.refresh(true);
  await assert.rejects(service.send('Test', '7300000000000000001', () => true), error => {
    assert.match(messageErrorText(error), /TikTok.*geweigerd/);
    assert.doesNotMatch(messageErrorText(error), /Euler/);
    return true;
  });
  release();
  assert.equal((await rechecking).chat, false);
  assert.equal(service.canSend(), false);
  assert.ok(!JSON.stringify(service.snapshot()).includes('PRIVATE'));
  time += 300_000;
  await service.refresh();
  assert.equal(service.canSend(), false);
  await assert.rejects(service.send('Geen retry', '7300000000000000001', () => true));
  assert.equal(fake.methods.filter(method => method === 'POST').length, 1);
  await service.refresh(true);
  assert.equal(service.canSend(), true);
  service.close();
});

test('directe commands werken zonder dashboard of Euler Premium en API behoudt Discord-beveiliging', async t => {
  let instance!: Fake;
  class Fake extends EventEmitter {
    readonly roomId = '7300000000000000001';
    constructor() { super(); instance = this; }
    async connect() {}
    async disconnect() {}
    async sendMessage() { assert.fail('Euler-verzending mag niet aangeroepen worden.'); }
  }
  let observed!: () => void;
  const sent = new Promise<void>(resolve => { observed = resolve; });
  const fake = transport(init => {
    assert.equal(JSON.parse(String(init.body)).content, 'Offline antwoord');
    observed();
    return Response.json({ status_code: 0, data: { msg_id_str: '7300000000000000002' } });
  });
  const config = readConfig(env);
  const store = createCommandStore(undefined, { revision: 0, commands: [
    { trigger: '!test', responses: ['Offline antwoord'], cooldownSeconds: 5, enabled: true }
  ] });
  const app = createTestApp(config, async () => ({ TikTokLiveConnection: Fake }), store, undefined,
    async () => { assert.fail('Euler-accountrechten zijn niet nodig voor directe verzending.'); },
    { request: fake.request, createSigner: async () => fakeSigner });
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  config.port = (app.server.address() as AddressInfo).port;
  t.after(() => app.close());
  const base = `http://127.0.0.1:${config.port}`;
  assert.equal((await fetch(base + '/api/capabilities')).status, 401);
  assert.equal((await fetch(base + '/api/commands')).status, 401);
  const request = authenticatedFetch(await signIn(config));
  const capabilities = await (await request(base + '/api/capabilities')).json();
  assert.equal(capabilities.chat, true);
  assert.equal(capabilities.moderation, false);
  const headers = { Origin: base, 'X-Requested-With': 'faynominaal', 'Content-Type': 'application/json' };
  assert.equal((await request(base + '/api/commands', { method: 'POST', headers, body: JSON.stringify(store.snapshot()) })).status, 200);
  assert.equal((await request(base + '/api/connect', { method: 'POST', headers })).status, 202);
  await new Promise(resolve => setImmediate(resolve));
  instance.emit('chat', { user: { uniqueId: 'viewer' }, content: '!test' });
  await sent;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fake.methods.filter(method => method === 'POST').length, 1);
  const snapshot = await (await request(base + '/api/snapshot')).json();
  assert.equal(snapshot.phase, 'connected');
  assert.ok(!/PRIVATE|sessionid|msToken/.test(JSON.stringify(snapshot)));
});
