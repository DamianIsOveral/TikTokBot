import test from 'node:test';
import assert from 'node:assert/strict';
import { auditedModeration, AuditOutcomeUnknownError } from '../src/server/moderation-action.ts';
import { createAuditStore } from '../src/server/moderation-audit.ts';
import { DirectTikTokError } from '../src/server/tiktok/direct-client.ts';
import type { AuditEntry, AuditInput, AuditStore } from '../src/shared/moderation.ts';

const input: AuditInput = { actor: { id: '100000000000000001', name: 'Fake Discord moderator' },
  target: { id: '123', name: 'fake_target' }, roomId: '7300000000000000001', action: 'mute', duration: 30 };
const unknownMessage = 'De actie kan zijn uitgevoerd, maar de uitkomst kon niet in het log worden bevestigd. Controleer TikTok; herhaal de actie niet blind.';

test('geauditeerde moderatie wacht op vastgelegde intentie vóór precies één externe actie', async () => {
  const store = createAuditStore();
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  const order: string[] = [];
  const audit: AuditStore = { list: store.list,
    async begin(value) { order.push('begin'); await ready; const entry = await store.begin(value); order.push('persisted'); return entry; },
    async finish(...args) { order.push('finish'); return store.finish(...args); } };
  let sends = 0;
  const result = auditedModeration(audit, input, async () => {
    sends++; order.push('perform'); assert.equal(store.list()[0]!.status, 'pending');
    assert.deepEqual(store.list()[0]!.actor, input.actor);
    return { accepted: true };
  });
  assert.equal(sends, 0); assert.deepEqual(order, ['begin']);
  release();
  assert.deepEqual(await result, { accepted: true });
  assert.equal(sends, 1); assert.deepEqual(order, ['begin', 'persisted', 'perform', 'finish']);
  assert.equal(store.list()[0]!.status, 'accepted');
});

test('een mislukte auditintentie voorkomt elke TikTok-actie en finishaanroep', async () => {
  let sends = 0; let finishes = 0;
  const failure = new Error('Auditopslag niet beschikbaar.');
  const audit: AuditStore = { list: () => [], async begin() { throw failure; }, async finish() { finishes++; assert.fail(); } };
  await assert.rejects(auditedModeration(audit, input, async () => { sends++; }), error => error === failure);
  assert.equal(sends, 0); assert.equal(finishes, 0);
});

test('opslagfalen na een geslaagde actie geeft onzekere uitkomst, behoudt pending en herhaalt niets', async () => {
  const store = createAuditStore();
  let sends = 0; let finishes = 0;
  const audit: AuditStore = { list: store.list, begin: store.begin,
    async finish(id, status) { finishes++; assert.equal(status, 'accepted'); assert.equal(id, store.list()[0]!.id); throw new Error('PRIVATE_STORAGE_FAILURE'); } };
  await assert.rejects(auditedModeration(audit, input, async () => { sends++; return { accepted: true }; }), error => {
    assert.ok(error instanceof AuditOutcomeUnknownError); assert.equal(error.message, unknownMessage);
    assert.ok(!error.message.includes('PRIVATE')); return true;
  });
  assert.equal(sends, 1); assert.equal(finishes, 1); assert.equal(store.list()[0]!.status, 'pending');
});

test('een expliciete TikTok-weigering wordt rejected gelogd en blijft dezelfde fout', async () => {
  const store = createAuditStore();
  let sends = 0;
  const failure = new DirectTikTokError('rejected', 200, 50003);
  await assert.rejects(auditedModeration(store, input, async () => { sends++; throw failure; }), error => error === failure);
  const entry = store.list()[0]!;
  assert.equal(sends, 1); assert.equal(entry.status, 'rejected');
  assert.equal(entry.reason, 'TikTok heeft het rechtstreekse verzoek geweigerd.');
  assert.deepEqual(entry.actor, input.actor); assert.deepEqual(entry.target, input.target);
});

test('netwerk-, lege en onbekende antwoorden blijven uncertain; ruwe fouten komen niet in audit', async () => {
  for (const failure of [new DirectTikTokError('network'), new DirectTikTokError('empty'),
    new DirectTikTokError('response'), new Error('PRIVATE_RAW_COOKIE_AND_RESPONSE')]) {
    const store = createAuditStore(); let sends = 0;
    await assert.rejects(auditedModeration(store, input, async () => { sends++; throw failure; }), error => error === failure);
    const entry = store.list()[0]!;
    assert.equal(sends, 1); assert.equal(entry.status, 'uncertain');
    assert.ok(entry.reason && !entry.reason.includes('PRIVATE'));
  }
});

test('ook bij een geweigerde actie met mislukte finish blijft de uitkomstcontrole expliciet nodig', async () => {
  const store = createAuditStore(); let sends = 0; let finishStatus: AuditEntry['status'] | undefined;
  const audit: AuditStore = { list: store.list, begin: store.begin,
    async finish(_id, status) { finishStatus = status; throw new Error('PRIVATE_FINISH_FAILURE'); } };
  await assert.rejects(auditedModeration(audit, input, async () => {
    sends++; throw new DirectTikTokError('rejected', 403);
  }), error => error instanceof AuditOutcomeUnknownError && error.message === unknownMessage);
  assert.equal(sends, 1); assert.equal(finishStatus, 'rejected'); assert.equal(store.list()[0]!.status, 'pending');
});
