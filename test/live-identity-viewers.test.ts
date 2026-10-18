import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { publicIdentity, safeAvatarUrl } from '../src/server/public-identity.ts';
import { incomingChat } from '../src/server/incoming-chat.ts';
import { createLiveActivity } from '../src/server/live-activity.ts';
import { createLive } from '../src/server/live.ts';
import { createSession } from '../src/server/session.ts';
import { readConfig } from '../src/server/config.ts';
import type { ServerEvent } from '../src/shared/events.ts';

const avatar = 'https://p16-sign.tiktokcdn-us.com/tos-useast/avatar.webp?signature=fake';

test('public identities accept SDK image shapes, bound display names and preserve canonical identities', () => {
  const user = { uniqueId: 'canonical', nickname: '\u061c\u202eShown\u0000\n name\u2069', idStr: '123',
    avatarThumb: { urlList: ['https://example.com/unsafe', avatar] } };
  assert.deepEqual(publicIdentity(user), { displayName: 'Shown name', avatarUrl: avatar });
  const chat = incomingChat({ user, content: '!test' }, 'canonical', '123');
  assert.equal(chat.user, 'canonical');
  assert.equal(chat.userId, '123');
  assert.equal(chat.isBot, true);
  assert.equal(chat.displayName, 'Shown name');
  assert.equal(chat.avatarUrl, avatar);
  assert.equal(incomingChat({ user: { ...user, nickname: 'the_bot' } }, 'the_bot').isBot, false);
  const normalize = createLiveActivity();
  for (const kind of ['member', 'follow', 'share', 'gift'] as const) {
    const activity = normalize(kind, { user });
    assert.equal(activity?.user, 'canonical');
    assert.equal(activity?.displayName, 'Shown name');
    assert.equal(activity?.avatarUrl, avatar);
  }
  assert.deepEqual(publicIdentity({ profilePicture: { url: [avatar] } }), { avatarUrl: avatar });
  assert.deepEqual(publicIdentity({ nickname: '\u202e \n', profilePicture: avatar }), {});
  assert.deepEqual(publicIdentity(null), {});
  assert.equal(publicIdentity({ nickname: 'a'.repeat(100) }).displayName?.length, 80);
  assert.deepEqual(publicIdentity({ avatarThumb: { urlList: 'not-array' } }), {});
  assert.deepEqual(publicIdentity({ avatarThumb: { urlList: [...Array(10).fill('bad'), avatar] } }), {});
  const session = createSession(() => {});
  session.receive(chat);
  session.receive(normalize('follow', { user })!);
  assert.equal(session.snapshot().messages[0].avatarUrl, avatar);
  assert.equal(session.snapshot().activity?.[0].displayName, 'Shown name');
});

test('avatar URLs only allow bounded HTTPS TikTok CDN URLs without authority tricks', () => {
  for (const domain of ['tiktok.com', 'tiktokcdn.com', 'tiktokcdn-us.com', 'byteoversea.com', 'ibytedtos.com']) {
    assert.equal(safeAvatarUrl(`https://p16.${domain}/avatar.webp`), `https://p16.${domain}/avatar.webp`);
  }
  for (const value of [undefined, {}, 42, '', 'bad', '//p16.tiktokcdn.com/a', 'http://p16.tiktokcdn.com/a',
    'data:image/png;base64,fake', 'https://user:pass@p16.tiktokcdn.com/a', 'https://p16.tiktokcdn.com:443/a',
    'https://p16.tiktokcdn.com:8080/a', 'https://tiktokcdn.com.evil.test/a', 'https://eviltiktokcdn.com/a',
    'https://localhost/a', 'https://127.0.0.1/a', 'https://[::1]/a', 'https://192.168.1.1/a',
    'https://p16.tiktokcdn.com./a', 'https://p16.tiktokcdn.com\\@evil.test/a',
    'https://p16.tiktokcdn.com/a\n', `https://p16.tiktokcdn.com/${'a'.repeat(2048)}`, 'https://%/a']) {
    assert.equal(safeAvatarUrl(value), undefined, String(value));
  }
  assert.deepEqual(publicIdentity({ avatarThumb: { urlList: ['http://bad', {}] },
    profilePicture: { url: ['https://127.0.0.1/a'] } }), {});
});

test('viewer state distinguishes unknown from zero, validates v3 total and ignores stale connector events', async t => {
  const instances: Fake[] = [];
  let finish!: () => void;
  class Fake extends EventEmitter {
    constructor() { super(); instances.push(this); }
    connect() { return instances.length === 1 ? new Promise<void>(resolve => { finish = resolve; }) : Promise.resolve(); }
    async disconnect() { this.emit('disconnected'); }
    async sendMessage() { assert.fail('Viewer metadata cannot send chat'); }
  }
  const published: ServerEvent[] = [];
  const session = createSession(event => published.push(event));
  const live = createLive(readConfig({ LIVE_AUTO_RECONNECT: 'false' }), session.receive,
    async () => ({ TikTokLiveConnection: Fake }));
  t.after(() => live.stop());
  assert.equal(session.snapshot().viewerCount, undefined);
  const pending = live.connect();
  await new Promise<void>(resolve => setImmediate(resolve));
  instances[0].emit('roomUser', { total: '50' });
  assert.equal(session.snapshot().viewerCount, undefined);
  finish(); await pending;
  instances[0].emit('roomUser', { total: '0', totalUser: '99999' });
  assert.equal(session.snapshot().viewerCount, 0);
  assert.deepEqual(published.at(-1), { type: 'viewers', count: 0 });
  for (const total of [undefined, null, {}, 12, NaN, Infinity, '-1', '1.5', '1e3', '', '1000000001', '99999999999']) {
    instances[0].emit('roomUser', { total });
    assert.equal(session.snapshot().viewerCount, 0);
  }
  for (const data of [null, false, {}, { viewerCount: 50 }, { totalUser: '5000' }]) instances[0].emit('roomUser', data);
  assert.equal(session.snapshot().viewerCount, 0);
  instances[0].emit('roomUser', { total: '1000000000' });
  assert.equal(session.snapshot().viewerCount, 1_000_000_000);
  instances[0].emit('disconnected');
  assert.equal(session.snapshot().viewerCount, undefined);
  instances[0].emit('roomUser', { total: '100' });
  assert.equal(session.snapshot().viewerCount, undefined);
  await live.connect();
  instances[0].emit('roomUser', { total: '100' });
  assert.equal(session.snapshot().viewerCount, undefined);
  instances[1].emit('roomUser', { total: '42' });
  assert.equal(session.snapshot().viewerCount, 42);
  await live.stop();
  instances[1].emit('roomUser', { total: '100' });
  assert.equal(session.snapshot().viewerCount, undefined);
  for (const phase of ['connecting', 'idle', 'stopped', 'disconnected', 'error'] as const) {
    session.receive({ type: 'viewers', count: 12 });
    session.receive({ type: 'status', phase, text: phase });
    assert.equal(session.snapshot().viewerCount, undefined);
  }
});
