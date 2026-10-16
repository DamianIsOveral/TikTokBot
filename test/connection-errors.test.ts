import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { connectionErrorMessage } from '../src/server/connection-errors.ts';
import { createLive } from '../src/server/live.ts';
import { readConfig } from '../src/server/config.ts';
import type { LiveEvent } from '../src/shared/events.ts';

test('verbindingsdiagnose herkent SDK-fouten en toont nooit ruwe secrets', () => {
  const missing = new Error('authenticate_websocket is true, but no whitelist host defined. Set WHITELIST_AUTHENTICATED_SESSION_ID_HOST');
  assert.match(connectionErrorMessage({ exception: missing }), /vertrouwde Euler-host ontbreekt/);
  assert.match(connectionErrorMessage(new Error('WHITELIST_AUTHENTICATED_SESSION_ID_HOST does not match sign server host')), /komt niet overeen/);
  assert.match(connectionErrorMessage(Object.assign(new Error('hidden'), { name: 'UserOfflineError' })), /niet live/);
  assert.match(connectionErrorMessage(Object.assign(new Error('hidden'), { name: 'SignatureRateLimitError' })), /begrens/);
  assert.match(connectionErrorMessage(Object.assign(new Error('hidden'), { name: 'PremiumFeatureError' })), /extra rechten/);
  assert.match(connectionErrorMessage(new Error('Unexpected sign server status 401')), /weigert toegang/);
  const failure = { config: { requestErrs: [{ code: 'ENOTFOUND', message: 'secret-api-key' }] } };
  assert.match(connectionErrorMessage(failure), /netwerk/);
  assert.ok(!connectionErrorMessage(new Error('Cookie: TOP_SECRET; sessionid=PRIVATE')).includes('TOP_SECRET'));
  const cyclic: { cause?: unknown } = {};
  cyclic.cause = cyclic;
  assert.match(connectionErrorMessage(cyclic), /onverwachte fout/);
});

test('live-status houdt concrete fout vast en kan daarna opnieuw verbinden', async () => {
  let attempts = 0;
  class Fake extends EventEmitter {
    constructor() { super(); }
    async connect() {
      if (++attempts === 1) {
        const exception = new Error('no whitelist host defined. Set WHITELIST_AUTHENTICATED_SESSION_ID_HOST');
        this.emit('error', { exception });
        throw exception;
      }
    }
    async disconnect() { this.emit('disconnected'); }
    async sendMessage() {}
  }
  const events: LiveEvent[] = [];
  const live = createLive(readConfig({}), event => events.push(event), async () => ({ TikTokLiveConnection: Fake }));
  await live.connect();
  assert.match(live.status, /vertrouwde Euler-host ontbreekt/);
  assert.equal(events.at(-1)?.type, 'status');
  await live.connect();
  assert.match(live.status, /LIVE verbonden/);
  await live.stop();
});
