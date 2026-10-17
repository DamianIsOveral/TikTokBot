import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { importUpstreamSigner, signWithUpstream } from '../src/server/tiktok/upstream-signer.ts';
import type { UpstreamSignerModule } from '../src/server/tiktok/upstream-signer.ts';
import { signingUserAgent } from '../src/server/tiktok/signing-profile.ts';
import { createReadOnlyRequest } from '../src/server/tiktok/read-only-request.ts';
import { createDirectClient, DirectTikTokError } from '../src/server/tiktok/direct-client.ts';

const input = {
  url: 'https://webcast.tiktok.com/webcast/room/chat/?room_id=7300000000000000001&content=OfflineTest',
  userAgent: signingUserAgent, cookie: 'sessionid=PRIVATE_SESSION; ttwid=PRIVATE_DEVICE', msToken: 'PRIVATE_MS'
};

test('adapter gebruikt de publieke upstream-API met dezelfde cookie-, token- en UA-context', async () => {
  const calls: string[] = [];
  const upstream: UpstreamSignerModule = {
    Signer: { create: async options => {
      calls.push('create');
      assert.deepEqual(options, { bundleSource: 'TEST_BUNDLE', userAgent: signingUserAgent,
        cookie: input.cookie, storedToken: input.msToken, pinned: false });
      return { sign: (url, product) => {
        calls.push('sign');
        assert.equal(url, input.url);
        assert.equal(product, 'fetch');
        return 'TEST_SIGNED_URL';
      } };
    } }, PRODUCT: { fetch: 'fetch' }
  };
  assert.equal(await signWithUpstream(upstream, 'TEST_BUNDLE', input), 'TEST_SIGNED_URL');
  assert.deepEqual(calls, ['create', 'sign']);
});

test('ongewijzigde TypeScript-modules met upstream .js-imports laden via de begrensde adapter', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'upstream-signer-'));
  try {
    await writeFile(join(folder, 'package.json'), '{"type":"module"}');
    await writeFile(join(folder, 'http.ts'), 'export const marker: string = "http";');
    await writeFile(join(folder, 'session.ts'), 'export const marker: string = "session";');
    await writeFile(join(folder, 'signer.ts'), `
      import { marker as a } from './http.js';
      import { marker as b } from './session.js';
      export const PRODUCT = { fetch: 'fetch' };
      export class Signer {
        static async create() { return { sign: () => a + ':' + b }; }
      }
    `);
    const module = await importUpstreamSigner(pathToFileURL(folder + '/'));
    assert.equal(await signWithUpstream(module, 'FAKE_BUNDLE', input), 'http:session');
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('alleen-lezen transport blokkeert POST en andere mutaties vóór enig netwerkverzoek', async () => {
  const observed: string[] = [];
  const transport = createReadOnlyRequest(async (_input, init) => {
    observed.push(init?.method || '');
    assert.equal(init?.redirect, 'error');
    return new Response(null);
  });
  await transport.request('https://www.tiktok.com/');
  await transport.request('https://webcast.tiktok.com/', { method: 'head' });
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    await assert.rejects(transport.request('https://webcast.tiktok.com/', { method }));
  }
  await assert.rejects(transport.request(new Request('https://webcast.tiktok.com/', { method: 'POST' })));
  assert.deepEqual(observed, ['GET', 'HEAD']);
  assert.deepEqual(transport.summary(), { methods: ['GET', 'HEAD'], requestCount: 2, blockedWrites: 6 });
});

test('LIVE-room wordt via één GET opgezocht met exacte string-ID en zonder connector of schrijfactie', async () => {
  for (const roomId of ['7300000000000000001', 7300000000000000001, '0', 'invalid']) {
    let calls = 0;
    const client = createDirectClient({ sessionId: 'PRIVATE_SESSION', targetIdc: 'test-idc', botUsername: 'test_bot' }, async (input, init) => {
      calls++;
      assert.equal(init?.method, 'GET');
      const url = new URL(String(input));
      assert.equal(url.origin, 'https://www.tiktok.com');
      assert.equal(url.pathname, '/api-live/user/room/');
      assert.equal(url.searchParams.get('uniqueId'), 'streamer');
      return Response.json({ statusCode: 0, data: { user: { roomId } } });
    });
    if (roomId === '7300000000000000001') assert.equal(await client.resolveRoomId('streamer'), roomId);
    else await assert.rejects(client.resolveRoomId('streamer'), DirectTikTokError);
    assert.equal(calls, 1);
  }
});
