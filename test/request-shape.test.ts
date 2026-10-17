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

test('browserchatvelden worden herkend zonder hun waarden te bewaren', () => {
  const request = entry();
  request.request.url += '&client_start_timestamp_millisecond=PRIVATE_TIME&emotes_with_index=PRIVATE_EMOTES&input_type=PRIVATE_TYPE&X-Dynosaur=SECRET_SIG';
  request.request.postData.mimeType = 'application/x-www-form-urlencoded; charset=UTF-8';
  const shapes = inspectTikTokHar({ log: { entries: [request] } });
  assert.ok(shapes[0].queryFields.includes('client_start_timestamp_millisecond'));
  assert.ok(shapes[0].queryFields.includes('emotes_with_index'));
  assert.ok(shapes[0].queryFields.includes('input_type'));
  assert.deepEqual(shapes[0].signatureFields, ['X-Dynosaur', 'X-Gnarly']);
  assert.deepEqual(shapes[0].bodyFields, ['content']);
  assert.ok(!/PRIVATE|SECRET/.test(JSON.stringify(shapes)));
});

test('HTTP 200 en TikTok-acceptatie blijven afzonderlijke resultaten', () => {
  const makeResponse = (status: unknown) => {
    const request = entry();
    request.response.content.text = JSON.stringify({ status_code: status, message: 'SECRET_ERROR', data: { token: 'SECRET_TOKEN' } });
    return request;
  };
  const shapes = inspectTikTokHar({ log: { entries: [makeResponse(0), makeResponse(10001), makeResponse('0'), makeResponse(null)] } });
  assert.deepEqual(shapes.map(shape => [shape.httpStatus, shape.apiStatusCode]), [[200, 0], [200, 10001], [200, null], [200, null]]);
  assert.ok(!/PRIVATE|SECRET/.test(JSON.stringify(shapes)));
});

test('HAR-analyse negeert ontbrekende, ongeldige, te grote en gecodeerde responses', () => {
  const malformed = entry();
  const oversized = entry(); oversized.response.content.text = JSON.stringify({ status_code: 0, data: 'x'.repeat(262_144) });
  const encoded = { ...entry(), response: { status: 200, content: { encoding: 'base64', text: 'eyJzdGF0dXNfY29kZSI6MH0=' } } };
  const shapes = inspectTikTokHar({ log: { entries: [malformed, oversized, encoded, { request: entry().request }] } });
  assert.ok(shapes.every(shape => shape.apiStatusCode === null));
});
