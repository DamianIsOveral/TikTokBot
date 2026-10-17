import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, stat, mkdir, readdir, rename, unlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAuditStore, loadAuditStore } from '../src/server/moderation-audit.ts';
import type { AuditEntry, AuditInput, AuditStatus } from '../src/shared/moderation.ts';

const input: AuditInput = { actor: { id: '100000000000000001', name: 'Fake moderator' },
  target: { id: '123', name: 'fake_target' }, roomId: '7300000000000000001', action: 'mute', duration: 30 };
const at = '2026-10-17T12:00:00.000Z';
const now = (): Date => new Date(at);
function fixture(id: number, status: AuditStatus = 'accepted'): AuditEntry {
  return { ...structuredClone(input), id: `fixture-${id}`, at, status };
}
async function temporary(t: TestContext): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'faynominaal-audit-'));
  t.after(async () => { await rm(path, { recursive: true, force: true }); });
  return path;
}

test('audit legt intentie duurzaam vast voordat caller een actie kan starten en bewaart het resultaat', async t => {
  const root = await temporary(t);
  const path = join(root, 'private', 'moderation-audit.json');
  const store = createAuditStore(path, [], now);
  const entry = await store.begin(input);
  assert.equal(entry.status, 'pending'); assert.equal(entry.at, at);
  const pending = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(pending.version, 1);
  assert.equal(pending.entries[0].id, entry.id);
  assert.equal(pending.entries[0].status, 'pending');
  const finished = await store.finish(entry.id, 'accepted');
  assert.equal(finished.status, 'accepted');
  assert.deepEqual((await loadAuditStore(path)).list(), [finished]);
  assert.deepEqual(await readdir(join(root, 'private')), ['moderation-audit.json']);
  if (process.platform !== 'win32') {
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.equal((await stat(join(root, 'private'))).mode & 0o777, 0o700);
  }
});

test('actor uit een CLI-proef is herkenbaar system en kan geen Discordgebruiker nabootsen', async () => {
  const store = createAuditStore();
  const cli = { ...structuredClone(input), actor: { id: 'system', name: 'CLI-test (geen Discordsessie)' } };
  assert.equal((await store.begin(cli)).actor.id, 'system');
  for (const actor of [{ id: 'system', name: 'Administrator' }, { id: 'System', name: cli.actor.name },
    { id: '123', name: 'Fake moderator' }, { id: '1'.repeat(21), name: 'Fake moderator' }]) {
    await assert.rejects(store.begin({ ...input, actor }), /Ongeldig moderatielog/);
  }
});

test('actor, doel en lijsten zijn snapshots; caller kan toekomstige of opgeslagen events niet muteren', async () => {
  const initial = fixture(1);
  const store = createAuditStore(undefined, [initial], now);
  initial.actor.name = 'Gewijzigd';
  const candidate = structuredClone(input);
  const operation = store.begin(candidate);
  candidate.actor.id = '100000000000000009'; candidate.target.name = 'ander_doel';
  const result = await operation;
  assert.equal(result.actor.id, input.actor.id); assert.equal(result.target.name, input.target.name);
  result.actor.name = 'Caller-mutatie';
  const list = store.list(); list[0]!.actor.id = '000000000000000000'; list[1]!.target.name = 'Mutatie';
  assert.equal(store.list()[0]!.actor.name, input.actor.name);
  assert.equal(store.list()[1]!.actor.name, input.actor.name);
  assert.equal(store.list()[1]!.target.name, input.target.name);
  assert.deepEqual(store.list(0), []); assert.equal(store.list(1).length, 1);
  for (const limit of [-1, 1001, 0.1, NaN, Infinity]) assert.throws(() => store.list(limit));
});

test('alleen expliciet toegestane velden worden opgeslagen, ook voor geneste identiteiten', async t => {
  const path = join(await temporary(t), 'moderation-audit.json');
  const store = createAuditStore(path, [], now);
  const candidate = { ...structuredClone(input), cookie: 'PRIVATE_COOKIE',
    actor: { ...input.actor, token: 'PRIVATE_ACTOR_TOKEN' }, target: { ...input.target, session: 'PRIVATE_SESSION' } };
  const entry = await store.begin(candidate);
  await store.finish(entry.id, 'rejected', 'TikTok weigerde deze actie.');
  const content = await readFile(path, 'utf8');
  assert.ok(!content.includes('PRIVATE'));
  assert.deepEqual(Object.keys(store.list()[0]!.actor), ['id', 'name']);
  assert.deepEqual(Object.keys(store.list()[0]!.target), ['id', 'name']);
  assert.equal(store.list()[0]!.reason, 'TikTok weigerde deze actie.');
});

test('gelijktijdige begin en finish verliezen geen events of actorinformatie', async t => {
  const path = join(await temporary(t), 'moderation-audit.json');
  const store = createAuditStore(path, [], now);
  const entries = await Promise.all(Array.from({ length: 16 }, (_, index) => store.begin({
    ...structuredClone(input), target: { id: String(index + 1), name: `fake_${index}` }
  })));
  assert.equal(new Set(entries.map(entry => entry.id)).size, 16);
  await Promise.all(entries.map((entry, index) => store.finish(entry.id, index % 2 ? 'accepted' : 'uncertain', 'Vaste diagnose.')));
  const loaded = (await loadAuditStore(path)).list();
  assert.equal(loaded.length, 16);
  assert.deepEqual(loaded.map(entry => entry.id), entries.map(entry => entry.id).reverse());
  assert.equal(loaded.filter(entry => entry.status === 'accepted').length, 8);
  assert.equal(loaded.filter(entry => entry.status === 'uncertain').length, 8);
  assert.ok(loaded.every(entry => entry.actor.id === input.actor.id));
});

test('een mislukte begin schrijft geen RAM-intentie en een mislukte finish behoudt pending op schijf', async t => {
  const root = await temporary(t);
  const folder = join(root, 'private');
  await writeFile(folder, 'blokkeer map');
  const store = createAuditStore(join(folder, 'moderation-audit.json'), [], now);
  await assert.rejects(store.begin(input), /niet veilig worden opgeslagen/);
  assert.deepEqual(store.list(), []);
  await unlink(folder); await mkdir(folder);
  const entry = await store.begin(input);
  const moved = join(root, 'saved');
  await rename(folder, moved); await writeFile(folder, 'blokkeer map');
  await assert.rejects(store.finish(entry.id, 'accepted'), /niet veilig worden opgeslagen/);
  assert.equal(store.list()[0]!.status, 'pending');
  assert.equal((await loadAuditStore(join(moved, 'moderation-audit.json'))).list()[0]!.status, 'pending');
  await unlink(folder); await rename(moved, folder);
  assert.equal((await store.finish(entry.id, 'uncertain', 'Uitkomst kon niet worden bevestigd.')).status, 'uncertain');
});

test('een herstart bewaart pending intenties zonder een actie opnieuw uit te voeren of succes te verzinnen', async t => {
  const path = join(await temporary(t), 'moderation-audit.json');
  const store = createAuditStore(path, [], now);
  const entry = await store.begin(input);
  const reloaded = await loadAuditStore(path);
  assert.deepEqual(reloaded.list(), [entry]);
  assert.equal((await reloaded.finish(entry.id, 'uncertain', 'Server herstart; uitkomst onbekend.')).status, 'uncertain');
});

test('maximaal duizend events blijven bewaard; onafgeronde intenties worden nooit verdrongen', async () => {
  const initial = Array.from({ length: 1000 }, (_, index) => fixture(index));
  initial[0]!.status = 'pending';
  const store = createAuditStore(undefined, initial, now);
  const newest = await store.begin(input);
  const kept = store.list(1000);
  assert.equal(kept.length, 1000); assert.equal(kept[0]!.id, newest.id);
  assert.ok(kept.some(entry => entry.id === 'fixture-0'));
  assert.ok(!kept.some(entry => entry.id === 'fixture-1'));
  const full = createAuditStore(undefined, initial.map(entry => ({ ...entry, status: 'pending' })), now);
  await assert.rejects(full.begin(input), /vol met onafgeronde acties/);
  assert.equal(full.list(1000).length, 1000);
});

test('bestandsgrootte is begrensd zonder pending te verwijderen', async t => {
  const path = join(await temporary(t), 'moderation-audit.json');
  const wide = Array.from({ length: 1000 }, (_, index) => ({ ...fixture(index),
    actor: { id: input.actor.id, name: '😀'.repeat(50) }, target: { id: '123', name: '😀'.repeat(50) },
    reason: '😀'.repeat(150) }));
  assert.throws(() => createAuditStore(undefined, wide), /Ongeldig moderatielog/);
  const nearLimit: AuditEntry[] = [];
  for (const entry of wide) {
    if (Buffer.byteLength(JSON.stringify({ version: 1, entries: [...nearLimit, entry] }) + '\n') > 1024 * 1024) break;
    nearLimit.push(entry);
  }
  const store = createAuditStore(path, nearLimit, now);
  const entry = await store.begin({ ...input, actor: wide[0]!.actor, target: wide[0]!.target });
  await store.finish(entry.id, 'accepted', wide[0]!.reason);
  assert.ok(!store.list(1000).some(item => item.id === 'fixture-0'));
  assert.equal(store.list()[0]!.id, entry.id);
  assert.ok((await stat(path)).size <= 1024 * 1024);
  await writeFile(path, Buffer.alloc(1024 * 1024 + 1, 32));
  await assert.rejects(loadAuditStore(path), /Kan data\/moderation-audit.json niet laden/);
});

test('audit weigert ongeldige velden en het achteraf wijzigen van een definitieve uitkomst', async () => {
  const store = createAuditStore(undefined, [], now);
  const badInputs = [
    { ...input, actor: { id: '123', name: 'mod' } }, { ...input, target: { id: '123.0', name: 'target' } },
    { ...input, actor: { ...input.actor, name: 'x'.repeat(101) } }, { ...input, roomId: '123' },
    { ...input, target: { ...input.target, name: 'line\nbreak' } }, { ...input, action: 'unknown' },
    { ...input, duration: -1 }, { ...input, duration: undefined }, { ...input, action: 'ban', duration: 30 }
  ];
  for (const candidate of badInputs) await assert.rejects(store.begin(candidate as AuditInput));
  const entry = await store.begin(input);
  for (const status of ['pending', 'unknown']) await assert.rejects(store.finish(entry.id, status as 'accepted'));
  await assert.rejects(store.finish(entry.id, 'rejected', 'x'.repeat(301)));
  await assert.rejects(store.finish(entry.id, 'rejected', 'line\nbreak'));
  await assert.rejects(store.finish('missing', 'accepted'));
  await store.finish(entry.id, 'accepted');
  await assert.rejects(store.finish(entry.id, 'rejected'), /al afgerond/);
  assert.equal(store.list()[0]!.status, 'accepted');
});

test('beschadigde opgeslagen logs blokkeren startup met een vaste fout zonder bestandinhoud te tonen', async t => {
  const path = join(await temporary(t), 'moderation-audit.json');
  const invalidDocuments: unknown[] = [null, [], { version: 2, entries: [] }, { version: 1, entries: {} },
    { version: 1, entries: [fixture(1), fixture(1)] },
    { version: 1, entries: [{ ...fixture(1), status: 'unknown' }] },
    { version: 1, entries: [{ ...fixture(1), at: 'not-a-date' }] },
    { version: 1, entries: Array.from({ length: 1001 }, (_, index) => fixture(index)) }];
  for (const value of invalidDocuments) {
    await writeFile(path, JSON.stringify(value));
    await assert.rejects(loadAuditStore(path), { message: 'Kan data/moderation-audit.json niet laden. Herstel dit bestand voordat de server wordt gestart.' });
  }
  await writeFile(path, '{PRIVATE_COOKIE');
  await assert.rejects(loadAuditStore(path), error => error instanceof Error && !error.message.includes('PRIVATE'));
  await unlink(path);
  assert.deepEqual((await loadAuditStore(path)).list(), []);
});
