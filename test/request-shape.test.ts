import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectTikTokHar } from '../src/server/tiktok/request-shape.ts';

const entry = () => ({ request: {
  method: 'POST', url: 'https://webcast.tiktok.com/webcast/room/chat/?room_id=PRIVATE_ROOM&msToken=SECRET_TOKEN&X-Gnarly=SECRET_SIG',
  queryString: [{ name: 'content', value: 'PRIVATE_MESSAGE' }, { name: 'SECRET_UNKNOWN', value: 'SECRET' }],
  headers: [{ name: 'Cookie', value: 'sessionid=SECRET_COOKIE' }, { name: 'TT-CSRF-Token', value: 'SECRET_CSRF' },
    { name: 'SECRET_HEADER', value: 'SECRET' }],
  postData: { mimeType: 'application/x-www-form-urlencoded', text: 'content=PRIVATE_MESSAGE&SECRET_BODY=SECRET' }
}, response: { status: 200, content: { text: 'PRIVATE_RESPONSE' } } });

test('HAR-analyse behoudt uitsluitend bekende veldnamen en nooit cookies, tokens of berichten', () => {
  const shapes = inspectTikTokHar({ log: { entries: [entry()] } });
  assert.equal(shapes.length, 1);
  assert.deepEqual(shapes[0].queryFields, ['X-Gnarly', 'content', 'msToken', 'room_id']);
  assert.deepEqual(shapes[0].bodyFields, ['content']);
  assert.deepEqual(shapes[0].headerFields, ['cookie', 'tt-csrf-token']);
  assert.deepEqual(shapes[0].signatureFields, ['X-Gnarly']);
  assert.equal(shapes[0].unknownQueryFieldCount, 1);
  assert.equal(shapes[0].unknownBodyFieldCount, 1);
  assert.equal(shapes[0].unknownHeaderFieldCount, 1);
  assert.ok(!/PRIVATE|SECRET/.test(JSON.stringify(shapes)));
});

test('HAR-analyse negeert andere sites, doelen, methodes en ongeldige URLs', () => {
  const urls = ['https://evil.example/webcast/room/chat/', 'https://webcast.tiktok.com.evil.example/webcast/room/chat/',
    'http://webcast.tiktok.com/webcast/room/chat/', 'https://secret@webcast.tiktok.com/webcast/room/chat/',
    'https://webcast.tiktok.com/webcast/feed/', 'ongeldige URL'];
  const entries = urls.map(url => ({ request: { method: 'POST', url } }));
  entries.push({ request: { method: 'DELETE', url: entry().request.url } });
  assert.deepEqual(inspectTikTokHar({ log: { entries } }), []);
  assert.throws(() => inspectTikTokHar({}));
});

test('HAR-analyse onderscheidt geweigerde requests en een preflight van geslaagde HTTP-verzoeken', () => {
  const rejected = entry(); rejected.response.status = 403;
  const preflight = entry(); preflight.request.method = 'OPTIONS'; preflight.response.status = 204;
  const shapes = inspectTikTokHar({ log: { entries: [preflight, rejected, entry()] } });
  assert.deepEqual(shapes.map(shape => [shape.method, shape.httpStatus]), [['OPTIONS', 204], ['POST', 403], ['POST', 200]]);
});
