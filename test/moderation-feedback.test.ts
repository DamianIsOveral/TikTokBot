import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { moderationFeedback } from '../src/server/moderation-feedback.ts';
import { createAuditStore, loadAuditStore } from '../src/server/moderation-audit.ts';
import type { AuditEntry } from '../src/shared/moderation.ts';

const roomId = '7300000000000000001';
const now = Date.parse('2026-10-18T12:00:10.000Z');
function entry(id: string, action: AuditEntry['action'], status: AuditEntry['status'], seconds: number,
  target = '456', room = roomId, duration = 30): AuditEntry {
  return { id, action, status, at: new Date(now + seconds * 1000).toISOString(), roomId: room,
    actor: { id: '111111111111111111', name: 'Moderator' }, target: { id: target, name: 'Viewer' },
    ...(action === 'mute' ? { duration } : {}) };
}

test('feedback selects newest accepted or uncertain per target and action axis in the current room', () => {
  const audit = createAuditStore(undefined, [entry('a', 'mute', 'accepted', -9), entry('b', 'ban', 'accepted', -8),
    entry('c', 'unmute', 'accepted', -7), entry('d', 'unban', 'uncertain', -6),
    entry('e', 'mute', 'rejected', -5), entry('f', 'ban', 'pending', -4),
    entry('g', 'mute', 'accepted', -3, '777', '7300000000000000002')]);
  const snapshot = moderationFeedback(audit, roomId, now);
  assert.deepEqual(snapshot, { roomId, serverNow: now, entries: [
    { userId: '456', name: 'Viewer', action: 'unban', status: 'uncertain', at: new Date(now - 6000).toISOString() },
    { userId: '456', name: 'Viewer', action: 'unmute', status: 'accepted', at: new Date(now - 7000).toISOString() }
  ] });
  assert.deepEqual(moderationFeedback(audit, undefined, now), { roomId: null, serverNow: now, entries: [] });
  snapshot.entries[0].name = 'Changed';
  assert.equal(moderationFeedback(audit, roomId, now).entries[0].name, 'Viewer');
});

test('feedback retains expected timed expiry and whole-LIVE mute without inventing remote state', () => {
  const audit = createAuditStore(undefined, [entry('a', 'mute', 'accepted', -9, '1', roomId, 5),
    entry('b', 'mute', 'accepted', -8, '2', roomId, 0), entry('c', 'mute', 'uncertain', -7, '3', roomId, 300),
    entry('d', 'mute', 'accepted', -7, '3', roomId, 60)]);
  const entries = moderationFeedback(audit, roomId, now).entries;
  assert.equal(entries[0].status, 'accepted');
  assert.equal(entries[0].duration, 60);
  assert.equal(entries.find(item => item.userId === '1')?.expiresAt, now - 4000);
  assert.equal(entries.find(item => item.userId === '2')?.expiresAt, undefined);
});

test('existing persisted audit reconstructs feedback after restart without secUid storage', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'moderation-feedback-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'audit.json');
  const audit = createAuditStore(path, [], () => new Date(now));
  const pending = await audit.begin({ actor: { id: '111111111111111111', name: 'Moderator' },
    target: { id: '456', name: 'Viewer' }, roomId, action: 'mute', duration: 300 });
  await audit.finish(pending.id, 'accepted');
  assert.deepEqual(moderationFeedback(await loadAuditStore(path), roomId, now), moderationFeedback(audit, roomId, now));
  assert.ok(!JSON.stringify(moderationFeedback(audit, roomId, now)).includes('secUid'));
});
