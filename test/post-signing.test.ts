import test from 'node:test';
import assert from 'node:assert/strict';
import { createDirectClient } from '../src/server/tiktok/direct-client.ts';
import { signPostWithUpstream } from '../src/server/tiktok/upstream-post-signer.ts';
import { signWithUpstream } from '../src/server/tiktok/upstream-signer.ts';
import type { UpstreamSignerModule } from '../src/server/tiktok/upstream-signer.ts';
import { signingSdkVersion, signingUserAgent, validateSigningInput } from '../src/server/tiktok/signing-profile.ts';
import type { SigningInput } from '../src/server/tiktok/signing-profile.ts';

const payload = { room_id: '7300000000000000001', content: 'Test "quotes", & + € 😀', emotes_with_index: '', input_type: 0,
  client_start_timestamp_millisecond: 1700000000123 };
const input: SigningInput = {
  url: `https://webcast.tiktok.com/webcast/room/chat/?${new URLSearchParams(Object.entries(payload).map(([key, value]) => [key, String(value)]))}`,
  userAgent: signingUserAgent, method: 'POST', body: JSON.stringify(payload), msToken: 'PRIVATE_TOKEN', cookie: 'sessionid=PRIVATE_SESSION'
};
const suffix = '&X-Dynosaur=test&msToken=PRIVATE_TOKEN&X-Bogus=test&X-Gnarly=test';

test('POST-body is verplicht, canoniek en identiek aan de actievelden in de query', () => {
  validateSigningInput(input);
  for (const invalid of [
    { ...input, body: undefined }, { ...input, method: undefined }, { ...input, body: 'null' },
    { ...input, body: JSON.stringify({ ...payload, input_type: '0' }) },
    { ...input, body: JSON.stringify({ ...payload, content: 'ander bericht' }) },
    { ...input, body: JSON.stringify({ ...payload, client_start_timestamp_millisecond: '1700000000123' }) },
    { ...input, url: input.url + '&content=dubbel' }, { ...input, body: JSON.stringify({ ...payload, extra: 'field' }) }
  ]) assert.throws(() => validateSigningInput(invalid));
});

test('POST-bridge geeft exacte body en sessiecontext door aan SDK-fetch zonder Node of netwerk', () => {
  const bootstrap = `
    globalThis.ttlPrepare = (bundle, encoded) => {
      const options = JSON.parse(encoded);
      if (options.userAgent !== ${JSON.stringify(input.userAgent)} || options.cookie !== ${JSON.stringify(input.cookie)}
        || options.xmst !== 'PRIVATE_TOKEN' || options.pinned !== false || bundle !== 'FAKE_SDK') throw Error();
      globalThis.__ttlPrepared = { w: { fetch(url, init) {
        if (typeof process !== 'undefined' || typeof require !== 'undefined' || typeof fetch !== 'undefined') throw Error();
        if (init.method !== 'POST' || init.headers['Content-Type'] !== 'application/json'
          || init.body !== ${JSON.stringify(input.body)}) throw Error();
        globalThis.__ttlCaptured = url + ${JSON.stringify(suffix)};
        return Promise.resolve({});
      } } };
      return JSON.stringify({ok: true});
    };
  `;
  assert.equal(signPostWithUpstream(bootstrap, 'FAKE_SDK', input), input.url + suffix);
  assert.throws(() => signPostWithUpstream('globalThis.ttlPrepare=()=>\'{"error":"private"}\'', '', input));
  assert.throws(() => signPostWithUpstream('while(true){}', '', input));
});

test('URL-only upstream-API weigert POST-context vóór initialisatie in plaats van stil GET te ondertekenen', async () => {
  const upstream = { Signer: { create: () => { throw new Error('Mag niet aangeroepen worden'); } } } as unknown as UpstreamSignerModule;
  await assert.rejects(signWithUpstream(upstream, 'FAKE_SDK', input), /ondersteunt geen POST-body/);
});

test('ondertekende bodybytes gaan ongewijzigd naar transport; groot bericht-ID blijft exact', async () => {
  let signed: SigningInput | undefined;
  let posts = 0;
  const client = createDirectClient({ sessionId: 'PRIVATE_SESSION', targetIdc: 'test-idc', botUsername: 'test_bot' },
    async (url, init) => {
      if (init?.method === 'POST') {
        posts++;
        assert.ok(signed);
        assert.equal(String(url), signed.url + suffix);
        assert.equal(init.body, signed.body);
        assert.equal(new Headers(init.headers).get('Content-Type'), 'application/json');
        const body = JSON.parse(String(init.body));
        assert.equal(body.content, payload.content);
        assert.equal(body.input_type, 0);
        assert.equal(typeof body.client_start_timestamp_millisecond, 'number');
        assert.ok(Math.abs(body.client_start_timestamp_millisecond - Date.now()) < 5000);
        for (const [key, value] of Object.entries(body)) assert.equal(new URL(String(url)).searchParams.get(key), String(value));
        return Response.json({ status_code: 0, data: { msg_id: 7300000000000000000, msg_id_str: '7300000000000000001' } });
      }
      if (init?.method === 'HEAD') return new Response(null);
      if (String(url).includes('/account/info/')) return Response.json({ data: { username: 'test_bot', user_id: '123' } });
      return new Response(`<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">${JSON.stringify({
        __DEFAULT_SCOPE__: { 'webapp.app-context': { csrfToken: 'PRIVATE_CSRF', wid: '123456789123456789' } }
      })}</script><script src="/webmssdk/${signingSdkVersion}/webmssdk.js"></script>`);
    }, { signRequest: async value => {
      validateSigningInput(value);
      signed = { ...value };
      return { signedUrl: value.url + suffix, signMs: 1, rssMiB: 64 };
    } });
  assert.deepEqual(await client.sendMessage(payload.room_id, 'streamer', payload.content), { messageId: '7300000000000000001' });
  assert.equal(posts, 1);
});
