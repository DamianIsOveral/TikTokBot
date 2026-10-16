import test from 'node:test';
import assert from 'node:assert/strict';
import { createDirectClient, DirectTikTokError, directErrorText } from '../src/server/tiktok/direct-client.ts';

const credentials = { sessionId: 'PRIVATE_SESSION', targetIdc: 'test-idc', botUsername: 'test_bot' };
const identity = () => Response.json({ data: { username: 'test_bot', user_id: '123456789123456789' } });
const livePage = () => new Response(`<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">${JSON.stringify({
  __DEFAULT_SCOPE__: { 'webapp.app-context': { csrfToken: 'PRIVATE_CSRF', wid: '123456789123456789' } }
})}</script>`);

test('directe client valideert identiteit en stuurt alleen naar vaste TikTok-host zonder retries', async () => {
  const requests: { url: URL; init?: RequestInit }[] = [];
  const fake: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url, init });
    if (url.pathname.includes('/account/info/')) return identity();
    if (url.hostname === 'www.tiktok.com') return livePage();
    return Response.json({ status_code: 0, data: { msg_id: '123456789123456789' } });
  };
  const client = createDirectClient(credentials, fake);
  const result = await client.sendMessage('123456789123456789', 'streamer', 'Testbericht');
  assert.equal(result.messageId, '123456789123456789');
  assert.equal(requests.length, 3);
  assert.equal(requests[0].init?.method, 'GET');
  assert.equal(requests[1].init?.method, 'GET');
  const sent = requests[2];
  assert.equal(sent.init?.method, 'POST');
  assert.equal(sent.url.origin, 'https://webcast.tiktok.com');
  assert.equal(sent.url.pathname, '/webcast/room/chat/');
  assert.equal(sent.url.searchParams.get('room_id'), '123456789123456789');
  assert.equal(sent.url.searchParams.get('content'), 'Testbericht');
  assert.equal(sent.init?.redirect, 'error');
  assert.ok(new Headers(sent.init?.headers).get('Cookie')?.includes('PRIVATE_SESSION'));
  assert.equal(new Headers(sent.init?.headers).get('tt-csrf-token'), 'PRIVATE_CSRF');
  assert.ok(!sent.url.toString().includes('PRIVATE_SESSION'));
  await client.sendMessage('123456789123456789', 'streamer', 'Tweede bericht');
  assert.equal(requests.length, 4);
});

test('verkeerd of verlopen botaccount blokkeert alle schrijfacties', async () => {
  for (const data of [{ username: 'ander_account', user_id: '123' }, {},
    { username: 'test_bot', user_id: '123', error_code: 1 }]) {
    let calls = 0;
    const client = createDirectClient(credentials, async (_input, init) => {
      calls++;
      assert.equal(init?.method, 'GET');
      return Response.json({ data });
    });
    await assert.rejects(client.sendMessage('123456789123456789', 'streamer', 'Test'), DirectTikTokError);
    assert.equal(calls, 1);
  }
  assert.throws(() => createDirectClient({ ...credentials, sessionId: 'secret; injected=1' }));
});

test('ontbrekende LIVE-paginagegevens blokkeren de actie vóór het POST-verzoek', async () => {
  let calls = 0;
  const client = createDirectClient(credentials, async (_input, init) => {
    calls++;
    assert.equal(init?.method, 'GET');
    return calls === 1 ? identity() : new Response('<html>Geen LIVE-context</html>');
  });
  await assert.rejects(client.sendMessage('123456789123456789', 'streamer', 'Test'), DirectTikTokError);
  assert.equal(calls, 2);
});

test('lege, onbekende, challenge- en foutantwoorden worden nooit als succes behandeld of gelekt', async () => {
  for (const response of [new Response(''), new Response('<html>SECRET</html>'),
    new Response('SECRET', { status: 403 }), Response.json({ status_code: 40001, message: 'SECRET' }),
    Response.json({ status_code: 10402, message: 'csrf SECRET' }, { status: 403 }),
    new Response('SECRET', { headers: { 'x-tt-verify-id': 'SECRET' } }),
    Response.json({ data: { message: 'SECRET' } })]) {
    let calls = 0;
    const client = createDirectClient(credentials, async () => ++calls === 1 ? identity() : calls === 2 ? livePage() : response);
    await assert.rejects(client.sendMessage('123456789123456789', 'streamer', 'Test'), error => {
      assert.ok(error instanceof DirectTikTokError);
      assert.ok(!`${JSON.stringify(error)} ${error.message} ${directErrorText(error)}`.includes('SECRET'));
      return true;
    });
    assert.equal(calls, 3);
  }
});

test('validatie voorkomt requests met ongeldige doelen en netwerkfouten lekken geen cookies', async () => {
  let calls = 0;
  const client = createDirectClient(credentials, async () => { calls++; throw new Error('PRIVATE_SESSION'); });
  for (const [room, user, text] of [['invalid', 'streamer', 'Test'], ['123456789123456789', '../other', 'Test'],
    ['123456789123456789', 'streamer', ''], ['123456789123456789', 'streamer', 'x'.repeat(201)]]) {
    await assert.rejects(client.sendMessage(room, user, text));
  }
  assert.equal(calls, 0);
  await assert.rejects(client.verifyIdentity(), error => {
    assert.ok(error instanceof DirectTikTokError);
    assert.equal(error.kind, 'network');
    assert.ok(!error.message.includes('PRIVATE_SESSION'));
    return true;
  });
});
