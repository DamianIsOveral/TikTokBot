import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { assertSigningVersion, signingSdkVersion, validateSignedUrl, validateSigningInput, signingUserAgent } from '../src/server/tiktok/signing-profile.ts';
import { verifySigningAsset } from '../src/server/tiktok/signing-assets.ts';
import { parseWebcastCsrf } from '../src/server/tiktok/csrf.ts';
import { createDirectClient, DirectTikTokError } from '../src/server/tiktok/direct-client.ts';
import type { SigningInput, DirectRequestSigner } from '../src/server/tiktok/signing-profile.ts';

const input: SigningInput = {
  url: 'https://webcast.tiktok.com/webcast/room/chat/?aid=1988&room_id=7300000000000000001&content=PRIVATE_MESSAGE',
  userAgent: signingUserAgent
};
const suffix = '&X-Dynosaur=PRIVATE_DYN&msToken=PRIVATE_MS&X-Bogus=PRIVATE_BOGUS&X-Gnarly=PRIVATE_GNARLY';

test('ondertekening behoudt exact de oorspronkelijke aanvraag en voegt alleen vier toegestane velden toe', () => {
  validateSignedUrl(input, input.url + suffix);
  for (const url of [input.url.replace('PRIVATE_MESSAGE', 'anders') + suffix,
    input.url.replace('7300000000000000001', '7300000000000000002') + suffix,
    input.url + suffix + '&sessionid=PRIVATE_SESSION', input.url + suffix + '&X-Bogus=dubbel',
    input.url + suffix.replace('X-Gnarly=PRIVATE_GNARLY', 'X-Gnarly='),
    input.url.replace('webcast.tiktok.com', 'evil.example') + suffix]) {
    assert.throws(() => validateSignedUrl(input, url));
  }
  for (const url of ['http://webcast.tiktok.com/webcast/room/chat/?room_id=7300000000000000001',
    input.url + '&X-Bogus=oud', input.url + '#fragment', input.url.replace('/chat/', '/ban/'),
    input.url.replace('webcast.tiktok.com', 'secret@webcast.tiktok.com')]) {
    assert.throws(() => validateSigningInput({ ...input, url }));
  }
});

test('gedownloade ondertekeningscode moet exact overeenkomen met de vastgelegde hash', () => {
  const source = Buffer.from('onschuldige testfixture');
  const digest = createHash('sha256').update(source).digest('hex');
  verifySigningAsset(source, digest);
  assert.throws(() => verifySigningAsset(Buffer.from('gewijzigd'), digest));
  assert.throws(() => verifySigningAsset(Buffer.alloc(0), digest));
  assert.throws(() => verifySigningAsset(Buffer.alloc(1_048_577), digest));
});

test('Webcast-CSRF gebruikt de token of dezelfde DOWNGRADE-terugval als de browser', () => {
  assert.deepEqual(parseWebcastCsrf('0,PRIVATE_CSRF,60000,ok,PRIVATE_ID'), { token: 'PRIVATE_CSRF', mode: 'token' });
  for (const value of [null, '', '401,,1,message,session', '0,,1000']) {
    assert.deepEqual(parseWebcastCsrf(value), { token: 'DOWNGRADE', mode: 'downgrade' });
  }
  assert.throws(() => parseWebcastCsrf('0,token\rinjectie,1000'));
});

const credentials = { sessionId: 'PRIVATE_SESSION', targetIdc: 'test-idc', botUsername: 'test_bot' };
function fakeRequests(requests: { url: URL; init?: RequestInit }[], csrf = '401,,1,unavailable,PRIVATE_ID'): typeof fetch {
  return async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url, init });
    if (url.pathname.includes('/account/info/')) return Response.json({ data: { username: 'test_bot', user_id: '123' } });
    if (init?.method === 'HEAD') return new Response(null, { headers: {
      'x-ware-csrf-token': csrf, 'Set-Cookie': 'csrf_session_id=PRIVATE_CSRF_SESSION; Secure; HttpOnly'
    } });
    if (url.hostname === 'www.tiktok.com') return new Response(`<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">${JSON.stringify({
      __DEFAULT_SCOPE__: { 'webapp.app-context': { csrfToken: 'PRIVATE_PAGE_CSRF', wid: '123456789123456789' } }
    })}</script><script src="https://example.invalid/webmssdk/${signingSdkVersion}/webmssdk.js"></script>`);
    return Response.json({ status_code: 0, data: { msg_id: '123456789123456789' } });
  };
}
const signer: DirectRequestSigner = async value => {
  assert.equal(value.userAgent, signingUserAgent);
  assert.equal(new URL(value.url).searchParams.get('input_type'), '0');
  assert.equal(new URL(value.url).searchParams.get('emotes_with_index'), '');
  assert.ok(!JSON.stringify(value).includes('PRIVATE_SESSION'));
  return { signedUrl: value.url + suffix, signMs: 1, rssMiB: 64 };
};

test('ondertekende voorbereiding doet alleen GET/HEAD en toont geen bericht, URL of credentials', async () => {
  const requests: { url: URL; init?: RequestInit }[] = [];
  const direct = createDirectClient(credentials, fakeRequests(requests), { signRequest: signer });
  const result = await direct.inspectMessage('7300000000000000001', 'streamer', 'PRIVATE_MESSAGE');
  assert.equal(result.sent, false);
  assert.equal(result.csrfMode, 'downgrade');
  assert.ok(result.queryFields.includes('X-Gnarly'));
  assert.ok(!/PRIVATE|https:/.test(JSON.stringify(result)));
  assert.deepEqual(requests.map(request => request.init?.method), ['GET', 'GET', 'HEAD']);
  const head = new Headers(requests[2].init?.headers);
  assert.equal(head.get('x-secsdk-csrf-request'), '1');
  assert.equal(head.get('x-secsdk-csrf-version'), '1.2.22');
});

test('ondertekende actie gebruikt coherente UA, Webcast-CSRF en hostgebonden CSRF-cookie zonder retries', async () => {
  for (const [csrf, expected] of [['401,,1,unavailable,id', 'DOWNGRADE'], ['0,PRIVATE_CSRF,60000,ok,id', 'PRIVATE_CSRF']]) {
    const requests: { url: URL; init?: RequestInit }[] = [];
    const direct = createDirectClient(credentials, fakeRequests(requests, csrf), { signRequest: signer });
    await direct.sendMessage('7300000000000000001', 'streamer', 'PRIVATE_MESSAGE');
    assert.deepEqual(requests.map(request => request.init?.method), ['GET', 'GET', 'HEAD', 'POST']);
    const headers = new Headers(requests[3].init?.headers);
    assert.equal(headers.get('User-Agent'), signingUserAgent);
    assert.equal(headers.get('x-secsdk-csrf-token'), expected);
    assert.equal(headers.get('tt-csrf-token'), null);
    assert.ok(headers.get('Cookie')?.includes('csrf_session_id=PRIVATE_CSRF_SESSION'));
    await direct.verifyIdentity();
    assert.ok(!new Headers(requests[4].init?.headers).get('Cookie')?.includes('csrf_session_id'));
  }
});

test('falende of vervalste ondertekening blokkeert iedere POST en lekt geen foutdetails', async () => {
  for (const badSigner of [async () => { throw new Error('PRIVATE_SESSION'); },
    async () => ({ signedUrl: input.url + suffix, signMs: 1, rssMiB: 64 })]) {
    const requests: { url: URL; init?: RequestInit }[] = [];
    const direct = createDirectClient(credentials, fakeRequests(requests), { signRequest: badSigner });
    await assert.rejects(direct.sendMessage('7300000000000000001', 'streamer', 'Ander bericht'), error => {
      assert.ok(error instanceof DirectTikTokError);
      assert.equal(error.kind, 'signing');
      assert.ok(!JSON.stringify(error).includes('PRIVATE'));
      return true;
    });
    assert.ok(requests.every(request => request.init?.method !== 'POST'));
  }
});

test('andere, ontbrekende of tegenstrijdige scriptversie stopt vóór ondertekening en POST', async () => {
  assertSigningVersion(`/webmssdk/${signingSdkVersion}/webmssdk.js`);
  for (const html of ['', '/webmssdk/1.0.0.388/webmssdk.js',
    `/webmssdk/${signingSdkVersion}/webmssdk.js /webmssdk/9.9.9/webmssdk.js`]) {
    assert.throws(() => assertSigningVersion(html));
    let calls = 0;
    let signed = false;
    const direct = createDirectClient(credentials, async (_input, init) => {
      assert.equal(init?.method, 'GET');
      if (++calls === 1) return Response.json({ data: { username: 'test_bot', user_id: '123' } });
      return new Response(html);
    }, { signRequest: async value => { signed = true; return signer(value); } });
    await assert.rejects(direct.sendMessage('7300000000000000001', 'streamer', 'Test'), error => {
      assert.ok(error instanceof DirectTikTokError);
      assert.equal(error.kind, html ? 'signing-version' : 'empty');
      return true;
    });
    assert.equal(calls, 2);
    assert.equal(signed, false);
  }
});
