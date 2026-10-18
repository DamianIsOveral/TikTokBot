import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createLiveActivity } from '../src/server/live-activity.ts';
import { createSession } from '../src/server/session.ts';
import { createLive } from '../src/server/live.ts';
import { readConfig } from '../src/server/config.ts';
import type { LiveEvent, ServerEvent } from '../src/shared/events.ts';

test('SDK activity is normalized to bounded public fields without raw payloads or media', () => {
  const normalize = createLiveActivity();
  const raw = { user: { uniqueId: '\u202eviewer\u0000', id: 'PRIVATE_ID', secUid: 'PRIVATE_SEC',
    profilePicture: 'https://example.invalid/secret' }, sessionId: 'PRIVATE_SESSION', content: '!test' };
  assert.deepEqual(normalize('member', { ...raw, action: 1 }), { type: 'activity', kind: 'join', user: 'viewer' });
  assert.deepEqual(normalize('follow', raw), { type: 'activity', kind: 'follow', user: 'viewer' });
  assert.deepEqual(normalize('share', raw), { type: 'activity', kind: 'share', user: 'viewer' });
  assert.equal(normalize('member', { ...raw, action: 3 }), undefined);
  assert.equal(normalize('member', { ...raw, action: -1 }), undefined);
  assert.equal(normalize('gift', null), undefined);
  assert.equal(normalize('gift', false), undefined);
  assert.deepEqual(normalize('member', { user: { nickname: 'Kijker' } }), { type: 'activity', kind: 'join', user: 'Kijker' });
  const gift = normalize('gift', { ...raw, user: { uniqueId: 'a'.repeat(100) },
    gift: { name: 'b'.repeat(100) }, repeatCount: Number.MAX_SAFE_INTEGER });
  assert.equal(gift?.user.length, 80);
  assert.equal(gift?.gift?.length, 80);
  assert.equal(gift?.count, 1_000_000);
  assert.ok(!JSON.stringify(normalize('follow', raw)).includes('PRIVATE'));
  assert.deepEqual(normalize('gift', { repeatCount: NaN }), { type: 'activity', kind: 'gift', user: 'Kijker', gift: 'Cadeau', count: 1 });
  assert.equal(normalize('gift', { repeatCount: -50, extendedGiftInfo: { name: 'Roos' } })?.gift, 'Roos');
});

test('combo gifts publish one completed streak, deduplicate cumulative counts and retain separate groups', () => {
  const normalize = createLiveActivity();
  const gift = { user: { uniqueId: 'viewer', id: '123' }, giftId: '10', groupId: 'streak-a', gift: { type: 1, name: 'Roos' } };
  assert.equal(normalize('gift', { ...gift, repeatCount: 1, repeatEnd: 0 }), undefined);
  assert.equal(normalize('gift', { ...gift, repeatCount: 2, repeatEnd: 0 }), undefined);
  assert.equal(normalize('gift', { ...gift, repeatCount: 3, repeatEnd: 1 })?.count, 3);
  assert.equal(normalize('gift', { ...gift, repeatCount: 3, repeatEnd: 1 }), undefined);
  assert.equal(normalize('gift', { ...gift, repeatCount: 2, repeatEnd: 1 }), undefined);
  assert.equal(normalize('gift', { ...gift, repeatCount: 5, repeatEnd: 1 })?.count, 2);
  assert.equal(normalize('gift', { ...gift, groupId: 'streak-b', repeatCount: 1, repeatEnd: 1 })?.count, 1);
  assert.equal(normalize('gift', { gift: { combo: true }, repeatCount: 3, repeatEnd: 0 }), undefined);
  const single = { gift: { name: 'Ster' }, groupId: '0', common: { msgId: 'message-1' }, repeatCount: 1 };
  assert.equal(normalize('gift', single)?.count, 1);
  assert.equal(normalize('gift', single), undefined);
  for (let i = 0; i < 1100; i++) normalize('gift', { ...single, common: { msgId: `message-${i}` } });
  assert.equal(normalize('gift', single)?.count, 1);
});

test('session bounds activity separately from chat, clones snapshots and resets alongside chat', () => {
  const published: ServerEvent[] = [];
  const session = createSession(event => published.push(event));
  for (let i = 0; i < 115; i++) session.receive({ type: 'activity', kind: 'join', user: String(i) });
  session.receive({ type: 'chat', user: 'viewer', text: 'chat blijft apart' });
  const snapshot = session.snapshot();
  assert.equal(snapshot.activity?.length, 100);
  assert.equal(snapshot.activity?.[0].user, '15');
  assert.equal(snapshot.activity?.at(-1)?.user, '114');
  assert.equal(snapshot.messages.length, 1);
  assert.equal(published[0].type, 'activity');
  assert.ok(snapshot.activity?.every(item => Number.isSafeInteger(item.id) && !Number.isNaN(Date.parse(item.time))));
  snapshot.activity![0].user = 'gewijzigd';
  assert.equal(session.snapshot().activity?.[0].user, '15');
  for (const phase of ['connecting', 'stopped', 'disconnected', 'error', 'idle'] as const) {
    session.receive({ type: 'activity', kind: 'follow', user: 'viewer' });
    session.receive({ type: 'status', phase, text: phase });
    assert.deepEqual(session.snapshot().activity, []);
    assert.deepEqual(session.snapshot().messages, []);
  }
});

test('only the active connector emits activity and activity cannot trigger bot commands', async t => {
  const instances: Fake[] = [];
  let sends = 0;
  let finish: (() => void) | undefined;
  class Fake extends EventEmitter {
    constructor() { super(); instances.push(this); }
    connect() { return instances.length === 1 ? new Promise<void>(resolve => { finish = resolve; }) : Promise.resolve(); }
    async disconnect() { this.emit('disconnected'); }
    async sendMessage() { sends++; }
  }
  const events: LiveEvent[] = [];
  const config = readConfig({ BOT_ENABLED: 'true', EULER_API_KEY: 'FAKE', TIKTOK_SESSION_ID: 'FAKE', TIKTOK_TARGET_IDC: 'test' });
  const live = createLive(config, event => events.push(event), async () => ({ TikTokLiveConnection: Fake }),
    () => [{ trigger: '!test', responses: ['Niet versturen'], cooldownSeconds: 30, enabled: true }], () => true);
  t.after(() => live.stop());
  const connecting = live.connect();
  await new Promise<void>(resolve => setImmediate(resolve));
  const raw = { user: { uniqueId: '!test' }, content: '!test', action: 1 };
  instances[0].emit('member', raw);
  assert.equal(events.filter(event => event.type === 'activity').length, 0);
  finish!(); await connecting;
  for (const source of ['member', 'gift', 'follow', 'share']) instances[0].emit(source, raw);
  assert.equal(events.filter(event => event.type === 'activity').length, 4);
  assert.ok(live.diagnostics().lastEventAt);
  assert.equal(sends, 0);
  await live.stop();
  instances[0].emit('member', raw);
  await live.connect();
  instances[0].emit('gift', raw);
  instances[1].emit('share', raw);
  assert.equal(events.filter(event => event.type === 'activity').length, 5);
  assert.equal(sends, 0);
});

test('activity panel defaults hidden, persists its toggle and renders bounded text safely newest first', async t => {
  class Node {
    id = ''; className = ''; textContent = ''; hidden = false; checked = false; dateTime = '';
    children: Node[] = [];
    attributes = new Map<string, string>();
    listeners = new Map<string, () => void>();
    append(...children: Node[]) { this.children.push(...children); }
    replaceChildren(...children: Node[]) { this.children = children; }
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    addEventListener(name: string, callback: () => void) { this.listeners.set(name, callback); }
  }
  const toggle = new Node(); const panel = new Node(); const feed = new Node(); panel.id = 'activity-panel';
  const nodes: Record<string, Node> = { '#activity-toggle': toggle, '#activity-panel': panel, '#activity-feed': feed };
  const saved = new Map<string, string>();
  const frames: (() => void)[] = [];
  const globals = {
    document: { querySelector: (selector: string) => nodes[selector], createElement: () => new Node(),
      createTextNode: (text: string) => Object.assign(new Node(), { textContent: text }) },
    localStorage: { getItem: (name: string) => saved.get(name), setItem: (name: string, value: string) => saved.set(name, value) },
    requestAnimationFrame: (callback: () => void) => frames.push(callback)
  };
  for (const [key, value] of Object.entries(globals)) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => { if (original) Object.defineProperty(globalThis, key, original); else Reflect.deleteProperty(globalThis, key); });
  }
  const client = await import(new URL('../dist/browser/client/live-activity.js', import.meta.url).href);
  const contents = (node: Node): string => node.textContent + node.children.map(contents).join('');
  const flush = () => { for (const frame of frames.splice(0)) frame(); };
  client.initializeLiveActivity();
  assert.equal(panel.hidden, true);
  assert.match(contents(feed), /Nog geen LIVE-activiteit/);
  toggle.checked = true; toggle.listeners.get('change')!();
  assert.equal(panel.hidden, false);
  assert.equal(toggle.attributes.get('aria-controls'), panel.id);
  assert.equal(toggle.attributes.get('aria-expanded'), 'true');
  assert.equal(saved.get('fay-live-activity'), 'true');
  for (let id = 0; id < 110; id++) client.receiveLiveActivity({ type: 'activity', kind: 'gift', id,
    user: `<img onerror=alert(${id})>`, gift: '<script>Cadeau</script>', count: 2, time: '2026-10-18T10:00:00Z' });
  assert.equal(frames.length, 1);
  flush();
  assert.equal(feed.children.length, 100);
  assert.match(contents(feed.children[0]), /Cadeau.*alert\(109\).*<script>Cadeau<\/script> ×2/);
  assert.equal(feed.children[0].children[0].attributes.get('aria-hidden'), 'true');
  assert.equal(feed.children[0].children[1].children[2].textContent.includes('<img'), true);
  client.replaceLiveActivity([{ type: 'activity', kind: 'join', id: 1, user: 'viewer', time: '2026-10-18T10:00:00Z' }]);
  flush(); assert.equal(feed.children.length, 1); assert.match(contents(feed), /Binnenkomst.*viewer is binnengekomen/);
  client.resetLiveActivity(); flush(); assert.match(contents(feed), /Nog geen LIVE-activiteit/);
  toggle.checked = false; toggle.listeners.get('change')!();
  assert.equal(panel.hidden, true); assert.equal(saved.get('fay-live-activity'), 'false');
});
