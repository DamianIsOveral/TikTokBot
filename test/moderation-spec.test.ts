import test from 'node:test';
import assert from 'node:assert/strict';
import { buildModerationList, buildModerationRequest, validateModerationSigning } from '../src/server/tiktok/moderation-spec.ts';
import type { ModerationAction, ModerationList } from '../src/server/tiktok/moderation-spec.ts';

const room = '7300000000000000001';
const target = { userId: '123', secUid: 'MS4w.test_uid-123' };
const base = 'https://webcast.tiktok.com';
function signed(action: ModerationAction, duration = 30): boolean {
  const request = buildModerationRequest(action, room, target, duration);
  return validateModerationSigning(new URL(request.path + '?aid=1988&browser_name=Mozilla', base),
    request.method, request.body, request.contentType);
}

test('moderatie volgt de JSON-bodyvelden van de webclient en bewaart exacte string-IDs', () => {
  assert.deepEqual(buildModerationRequest('mute', room, target), {
    path: '/webcast/room/silence/', method: 'POST', contentType: 'application/json',
    body: `{"room_id":"${room}","user_id":"123","silence_type":1,"sec_user_id":"${target.secUid}","duration":30}`
  });
  assert.equal(buildModerationRequest('unmute', room, target).body,
    `{"room_id":"${room}","user_id":"123","sec_user_id":"${target.secUid}"}`);
  assert.equal(buildModerationRequest('ban', room, target).body,
    `{"room_id":"${room}","kick_uid":"123","sec_kick_uid":"${target.secUid}"}`);
  for (const action of ['mute', 'unmute', 'ban', 'unban'] as const) assert.equal(signed(action), true);
});

test('mute ondersteunt alleen de gehele LIVE of de vastgelegde secondenopties', () => {
  for (const duration of [0, 5, 30, 60, 300]) {
    const body = JSON.parse(buildModerationRequest('mute', room, target, duration).body);
    assert.equal(body.duration, duration);
    assert.equal(body.silence_type, duration === 0 ? 0 : 1);
    assert.equal(signed('mute', duration), true);
  }
  for (const duration of [-1, 1, 10, 301, 30.5, NaN, Infinity]) {
    assert.throws(() => buildModerationRequest('mute', room, target, duration));
  }
});

test('unban gebruikt canoniek gesorteerde formdata en geen JSON', () => {
  const request = buildModerationRequest('unban', room, target);
  assert.deepEqual(request, { path: '/webcast/room/unkick/user/', method: 'POST',
    contentType: 'application/x-www-form-urlencoded', body: `kick_uid=123&room_id=${room}&sec_kick_uid=${target.secUid}` });
  const url = new URL(request.path, base);
  for (const body of [request.body + '&kick_uid=456', `room_id=${room}&kick_uid=123&sec_kick_uid=${target.secUid}`,
    request.body.replace('123&', '%31%32%33&'), request.body + '&unknown=1', JSON.stringify(target)]) {
    assert.throws(() => validateModerationSigning(url, 'POST', body, request.contentType));
  }
  assert.throws(() => validateModerationSigning(url, 'POST', request.body, 'application/json'));
});

test('bekende moderatiepaden weigeren ontbrekende POST-context en verkeerde media types', () => {
  for (const action of ['mute', 'unmute', 'ban', 'unban'] as const) {
    const request = buildModerationRequest(action, room, target);
    const url = new URL(request.path, base);
    assert.throws(() => validateModerationSigning(url, undefined, undefined));
    assert.throws(() => validateModerationSigning(url, undefined, request.body, request.contentType));
    assert.throws(() => validateModerationSigning(url, 'POST', undefined, request.contentType));
    assert.throws(() => validateModerationSigning(url, 'POST', request.body));
    assert.throws(() => validateModerationSigning(url, 'POST', request.body, 'text/plain'));
  }
  assert.equal(validateModerationSigning(new URL('/webcast/room/chat/', base), undefined, undefined), false);
  assert.equal(validateModerationSigning(new URL('/arbitrary', base), 'POST', 'invalid'), false);
});

test('JSON moet exact dezelfde veldvolgorde, types en byteweergave als de webclient gebruiken', () => {
  const request = buildModerationRequest('mute', room, target);
  const value = JSON.parse(request.body);
  const url = new URL(request.path, base);
  const invalid = [
    JSON.stringify({ ...value, unknown: true }), JSON.stringify(value, null, 2),
    JSON.stringify({ user_id: value.user_id, ...value }),
    JSON.stringify({ ...value, silence_type: 0 }), JSON.stringify({ ...value, duration: '30' }),
    JSON.stringify({ ...value, room_id: Number(room) }), JSON.stringify({ ...value, user_id: 123 }),
    JSON.stringify({ ...value, duration: -1 }), JSON.stringify({ ...value, duration: 0 }),
    request.body.replace('"user_id":"123"', '"user_id":"123","user_id":"123"'),
    'null', '[]', '{}', '{INVALID_PRIVATE_VALUE', ' '.repeat(4097)
  ];
  for (const body of invalid) {
    assert.throws(() => validateModerationSigning(url, 'POST', body, 'application/json'));
  }
  try { validateModerationSigning(url, 'POST', '{INVALID_PRIVATE_VALUE', 'application/json'); }
  catch (error) { assert.ok(error instanceof Error && !error.message.includes('PRIVATE')); }
});

test('POST-moderatie weigert actievelden in query, ook wanneer die dezelfde waarden hebben', () => {
  const request = buildModerationRequest('ban', room, target);
  for (const query of [`room_id=${room}`, 'kick_uid=123', 'user_id=123', 'duration=30',
    'silence_type=1', 'offset=0', 'anchor_id=123', 'sec_user_id=test', 'cursor=1']) {
    assert.throws(() => validateModerationSigning(new URL(request.path + '?' + query, base),
      request.method, request.body, request.contentType));
  }
});

test('moderatie-input begrenst IDs en weigert ongeldige actie, gebruiker en secUID', () => {
  for (const roomId of ['', '123', '0'.repeat(26), '7300000000000000001&inject=1']) {
    assert.throws(() => buildModerationRequest('ban', roomId, target));
  }
  for (const badTarget of [{ userId: '', secUid: 'valid' }, { userId: '1'.repeat(26), secUid: 'valid' },
    { userId: '123.0', secUid: 'valid' }, { userId: '123', secUid: '' }, { userId: '123', secUid: 'x'.repeat(257) },
    { userId: '123', secUid: 'value&inject=1' }, { userId: '123', secUid: 'line\r\nbreak' }]) {
    assert.throws(() => buildModerationRequest('ban', room, badTarget));
  }
  assert.throws(() => buildModerationRequest('unknown' as ModerationAction, room, target));
});

test('lijsten hebben vaste paginaomvang, nulgebaseerde pagina en begrensde cursor', () => {
  assert.deepEqual(buildModerationList('blocked', room), {
    path: '/webcast/room/kick/list/', query: { room_id: room, offset: '0', count: '20' }
  });
  assert.deepEqual(buildModerationList('muted', room, 49, '123456'), {
    path: '/webcast/room/silence/list/', query: { room_id: room, offset: '980', count: '20', cursor: '123456' }
  });
  for (const page of [-1, 50, 0.5, NaN, Infinity]) assert.throws(() => buildModerationList('muted', room, page));
  for (const cursor of ['x', '1&room_id=1', '1'.repeat(129)]) assert.throws(() => buildModerationList('muted', room, 0, cursor));
  assert.throws(() => buildModerationList('blocked', room, 0, '123'));
  assert.throws(() => buildModerationList('unknown' as ModerationList, room));
});

test('lijstsigning accepteert browsercontext maar weigert dubbele en afwijkende actievelden', () => {
  for (const list of ['muted', 'blocked'] as const) {
    const request = buildModerationList(list, room, 2);
    const url = new URL(request.path, base);
    url.search = new URLSearchParams({ ...request.query, aid: '1988' }).toString();
    assert.equal(validateModerationSigning(url, undefined, undefined), true);
    for (const query of ['&room_id=' + room, '&count=20', '&user_id=123', '&duration=30']) {
      assert.throws(() => validateModerationSigning(new URL(url.href + query), undefined, undefined));
    }
    for (const [name, value] of [['offset', '1'], ['offset', '1000'], ['offset', '020'], ['count', '21']]) {
      const changed = new URL(url); changed.searchParams.set(name!, value!);
      assert.throws(() => validateModerationSigning(changed, undefined, undefined));
    }
    assert.throws(() => validateModerationSigning(url, 'POST', undefined));
    assert.throws(() => validateModerationSigning(url, undefined, ''));
    assert.throws(() => validateModerationSigning(url, undefined, undefined, 'application/json'));
  }
});

test('moderatorlijst vereist room, anchor en beide secUIDs zonder schrijfactie', () => {
  const url = new URL('/webcast/user/admin/list/', base);
  url.search = new URLSearchParams({ room_id: room, anchor_id: '123', sec_anchor_id: 'SEC.anchor', sec_user_id: 'SEC.bot', aid: '1988' }).toString();
  assert.equal(validateModerationSigning(url, undefined, undefined), true);
  for (const field of ['room_id', 'anchor_id', 'sec_anchor_id', 'sec_user_id']) {
    const missing = new URL(url); missing.searchParams.delete(field);
    assert.throws(() => validateModerationSigning(missing, undefined, undefined));
    const duplicate = new URL(url); duplicate.searchParams.append(field, '123');
    assert.throws(() => validateModerationSigning(duplicate, undefined, undefined));
  }
  assert.throws(() => validateModerationSigning(new URL(url.href + '&user_id=123'), undefined, undefined));
  assert.throws(() => validateModerationSigning(url, 'POST', '{}', 'application/json'));
});

test('moderatieprofiel vereist de exacte room, eigenaar en bot binnen de vaste profielcontext', () => {
  const url = new URL('/webcast/user/', base);
  url.search = new URLSearchParams({ current_room_id: room, owner_user_id: '456', target_uid: '123',
    aid: '1988', request_from: 'profile_card_v2', browser_name: 'Mozilla' }).toString();
  assert.equal(validateModerationSigning(url, undefined, undefined), true);
  for (const field of ['current_room_id', 'owner_user_id', 'target_uid', 'request_from', 'aid']) {
    const missing = new URL(url); missing.searchParams.delete(field);
    assert.throws(() => validateModerationSigning(missing, undefined, undefined));
    const duplicate = new URL(url); duplicate.searchParams.append(field, url.searchParams.get(field)!);
    assert.throws(() => validateModerationSigning(duplicate, undefined, undefined));
  }
  for (const [field, value] of [['current_room_id', '123'], ['target_uid', '123.0'],
    ['owner_user_id', '-1'], ['request_from', 'arbitrary'], ['aid', '123']]) {
    const changed = new URL(url); changed.searchParams.set(field!, value!);
    assert.throws(() => validateModerationSigning(changed, undefined, undefined));
  }
  assert.throws(() => validateModerationSigning(new URL(url.href + '&room_id=' + room), undefined, undefined));
  assert.throws(() => validateModerationSigning(url, 'POST', '{}', 'application/json'));
});
