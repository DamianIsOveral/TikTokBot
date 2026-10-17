import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { chatIdentity } from '../src/server/chat-identity.ts';
import { createLive } from '../src/server/live.ts';
import { readConfig } from '../src/server/config.ts';
import type { LiveEvent } from '../src/shared/events.ts';
import type { TikTokMessage } from '../src/server/types.ts';

test('SDK-chat met lege idStr behoudt de exacte string-ID uit id tot aan de sessie', async t => {
  let connector!: Fake;
  class Fake extends EventEmitter {
    constructor() { super(); connector = this; }
    async connect() {}
    async disconnect() {}
    async sendMessage() { assert.fail('Geen echte of nagebootste chatverzending nodig.'); }
  }
  const events: LiveEvent[] = [];
  const live = createLive(readConfig({}), event => events.push(event), async () => ({ TikTokLiveConnection: Fake }));
  t.after(() => live.stop());
  await live.connect();
  connector.emit('chat', { content:'Een normaal bericht', user:{ id:'7696933735691142176',idStr:'',secUid:'SEC_VIEWER' } });
  const chat = events.find(event => event.type === 'chat');
  assert.ok(chat?.type === 'chat');
  assert.equal(chat.userId, '7696933735691142176');
  assert.equal(chat.secUid, 'SEC_VIEWER');
});

test('ID-normalisatie gebruikt idStr wanneer geldig en accepteert geen afgeronde getallen', () => {
  assert.equal(chatIdentity({idStr:'123',id:'456'}).userId,'123');
  assert.equal(chatIdentity({id:'456'}).userId,'456');
  for(const id of [7696933735691142176,NaN,0,'0','-2','1e12',' 123','1.5','x','9'.repeat(26)]) {
    assert.equal(chatIdentity({ id } as unknown as NonNullable<TikTokMessage['user']>).userId,undefined);
  }
  assert.equal(chatIdentity({id:'123',secUid:'bad\nvalue'}).secUid,undefined);
});
