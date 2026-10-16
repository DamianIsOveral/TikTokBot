import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { messageErrorText } from '../src/server/message-errors.ts';
import { createLive } from '../src/server/live.ts';
import { readConfig } from '../src/server/config.ts';
import { createSession } from '../src/server/session.ts';
import type { LiveEvent } from '../src/shared/events.ts';

test('verzendfouten zijn specifiek en bevatten geen ruwe credentials', () => {
  const cases: [unknown, RegExp][] = [
    [Object.assign(new Error('secret'), { name: 'PremiumFeatureError' }), /verzendrechten/],
    [{ response: { status: 401 } }, /API-sleutel/],
    [{ response: { status: 429 } }, /begrensd/],
    [new Error('sessionid=SECRET expired'), /botcookies/],
    [new Error('targetRoomId required'), /doelkanaal/],
    [{ code: 'ECONNRESET' }, /netwerkfout/]
  ];
  for (const [error, pattern] of cases) {
    const text = messageErrorText(error);
    assert.match(text, pattern);
    assert.ok(!text.includes('SECRET'));
  }
});

test('mislukt botbericht laat chat verbonden en blijft zichtbaar na vernieuwen', async () => {
  let instance!: Fake;
  let finished!: () => void;
  const done = new Promise<void>(resolve => { finished = resolve; });
  class Fake extends EventEmitter {
    constructor() { super(); instance = this; }
    async connect() {}
    async disconnect() {}
    async sendMessage() {
      const exception = Object.assign(new Error('paid plan SECRET_COOKIE'), { name: 'PremiumFeatureError' });
      this.emit('error', { info: 'Failed to send message.', exception });
      throw exception;
    }
  }
  const events: LiveEvent[] = [];
  const session = createSession(() => {});
  const config = readConfig({ BOT_ENABLED: 'true', EULER_API_KEY: 'dummy', TIKTOK_SESSION_ID: 'dummy', TIKTOK_TARGET_IDC: 'dummy' });
  const live = createLive(config, event => {
    events.push(event);
    session.receive(event);
    if (event.type === 'bot') finished();
  }, async () => ({ TikTokLiveConnection: Fake }), undefined, () => true);
  await live.connect();
  instance.emit('chat', { content: '!discord', user: { uniqueId: 'tester' } });
  await done;
  assert.equal(session.snapshot().phase, 'connected');
  assert.match(session.snapshot().botStatus || '', /verzendrechten/);
  assert.equal(session.snapshot().messages.length, 1);
  assert.ok(!JSON.stringify(events).includes('SECRET_COOKIE'));
  await live.stop();
});
