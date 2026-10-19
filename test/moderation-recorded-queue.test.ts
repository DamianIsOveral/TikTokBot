import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createModerationRoutes } from '../src/server/http/moderation-routes.ts';
import { createAuditStore } from '../src/server/moderation-audit.ts';
import { createOperationQueue } from '../src/server/operation-queue.ts';
import { createSession } from '../src/server/session.ts';
import { readConfig } from '../src/server/config.ts';
import { secureRequest } from '../src/server/http/security.ts';

test('queued recorded restore rechecks accepted state, expiry, room and access before starting its audit', async t => {
  for (const change of ['uncertain', 'reverted', 'expiry', 'room', 'authorization'] as const) {
    await t.test(change, { timeout: 5000 }, async t => {
      const audit = createAuditStore();
      const user = { id: '111111111111111111', name: 'Moderator', role: 'admin' as const };
      const live = { roomId: '7300000000000000001' };
      const input = { actor: user, target: { id: '456', name: 'viewer' }, roomId: live.roomId,
        action: 'mute' as const, duration: change === 'expiry' ? 5 : 0 };
      const first = await audit.begin(input);
      await audit.finish(first.id, 'accepted');
      const session = createSession(() => {});
      session.receive({ type: 'chat', user: 'viewer', userId: '456', secUid: 'SEC_VIEWER', text: 'Message' });
      const run = createOperationQueue();
      let release!: () => void;
      const hold = new Promise<void>(resolve => { release = resolve; });
      const blocker = run(() => hold);
      let queued!: () => void;
      const reached = new Promise<void>(resolve => { queued = resolve; });
      let calls = 0;
      const moderation = { async act() { calls++; throw new Error('Stale action reached TikTok'); } };
      type Direct = NonNullable<Parameters<typeof createModerationRoutes>[1]>;
      const direct = { withModeration(operation: (mod: typeof moderation) => Promise<unknown>) {
        const pending = run(() => operation(moderation));
        queued();
        return pending;
      } } as unknown as Direct;
      let authorized = true;
      const config = readConfig({ TIKTOK_MODERATION_ENABLED: 'true' });
      const route = createModerationRoutes(config, direct,
        live as Parameters<typeof createModerationRoutes>[2], session, audit);
      const server = createServer((req, res) => { if (secureRequest(req, res, config)) void route(req, res, user, () => authorized); });
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      t.after(() => release());
      t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
      config.port = (server.address() as AddressInfo).port;
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const pending = fetch(base + '/api/moderation', { method: 'POST',
        headers: { Origin: base, 'X-Requested-With': 'faynominaal', 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unmute', targetId: '456', recorded: true }) });
      await Promise.race([reached, pending.then(response => { throw new Error(`Queue was not reached: HTTP ${response.status}`); })]);
      if (change === 'uncertain' || change === 'reverted') {
        const latest = await audit.begin({ ...input, ...(change === 'reverted' ? { action: 'unmute' as const, duration: undefined } : {}) });
        await audit.finish(latest.id, change === 'uncertain' ? 'uncertain' : 'accepted');
      } else if (change === 'expiry') {
        const now = Date.now() + 6000;
        t.mock.method(Date, 'now', () => now);
      } else if (change === 'room') live.roomId = '7300000000000000002';
      else authorized = false;
      const count = audit.list().length;
      release();
      await blocker;
      assert.equal((await pending).status, 502);
      assert.equal(calls, 0);
      assert.equal(audit.list().length, count);
    });
  }
});
