import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { AccessSettings } from '../src/shared/auth.ts';
import { createAccessStore, loadAccessStore } from '../src/server/auth/access-store.ts';
import { readConfig } from '../src/server/config.ts';
import { ADMIN, MEMBER, authenticatedFetch, createTestApp, signIn } from './auth-fixture.ts';

test('opmerkingen blijven bewaard na herladen, ook voor vaste beheerders', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'fay-access-comments-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'access.json');
  const store = await loadAccessStore(path, [ADMIN]);
  const users = [{ id: ADMIN, role: 'admin', comment: '  Hoofdbeheerder  ' },
    { id: MEMBER, role: 'member', comment: '<Team "Chat"> & vrienden 👋' }];
  const saved = await store.save({ revision: 0, users });
  assert.equal(saved.users.find(user => user.id === ADMIN)?.comment, 'Hoofdbeheerder');
  assert.equal(saved.users.find(user => user.id === MEMBER)?.comment, users[1].comment);
  assert.equal(saved.revision, 1);
  const restarted = await loadAccessStore(path, [ADMIN]);
  assert.deepEqual(restarted.snapshot(), { ...saved, users: [saved.users[1], saved.users[0]] });
  assert.equal(restarted.role(ADMIN), 'admin');
  saved.users[0].comment = 'gewijzigde kopie';
  assert.equal(restarted.snapshot().users.find(user => user.id === ADMIN)?.comment, 'Hoofdbeheerder');
  const cleared = await restarted.save({ revision: 1, users: users.map(user => ({ ...user, comment: ' ' })) });
  assert.ok(cleared.users.every(user => user.comment === undefined));
  assert.ok(!('comment' in JSON.parse(await readFile(path, 'utf8')).users[0]));
});

test('bestaande toegangslijst zonder opmerkingen blijft compatibel', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'fay-access-legacy-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'access.json');
  const legacy = { revision: 4, users: [{ id: MEMBER, role: 'member' }, { id: ADMIN, role: 'member' }] };
  await writeFile(path, JSON.stringify(legacy));
  const store = await loadAccessStore(path, [ADMIN]);
  assert.deepEqual(store.snapshot(), { revision: 4, protectedIds: [ADMIN],
    users: [{ id: MEMBER, role: 'member' }, { id: ADMIN, role: 'admin' }] });
  assert.equal((await store.save(store.snapshot())).revision, 5);
});

test('opmerkingen weigeren ongeldige types, te lange tekst en besturingstekens zonder dataverlies', async () => {
  const store = createAccessStore([ADMIN]);
  const initial = store.snapshot();
  const invalid = [null, 123, {}, [], 'a'.repeat(121), '\nnaam', 'naam\t', '\u0000', '\u007f', '\u0085', '\u202e', '\ud800'];
  for (const comment of invalid) {
    const document = { revision: 0, users: [{ id: ADMIN, role: 'admin', comment }] };
    assert.throws(() => store.save(document), /Opmerkingen/, JSON.stringify(comment));
    assert.throws(() => createAccessStore([ADMIN], undefined, document), /Opmerkingen/);
  }
  assert.deepEqual(store.snapshot(), initial);
  const saved = await store.save({ revision: 0, users: [{ id: ADMIN, role: 'admin', comment: 'a'.repeat(120) }] });
  assert.equal(saved.users[0].comment?.length, 120);
  assert.throws(() => store.save({ revision: 1, users: [{ id: ADMIN, role: 'member', comment: 'Naam' }] }), /Vaste beheerders/);
  assert.throws(() => store.save({ revision: 1, users: [] }), /Vaste beheerders/);
  await assert.rejects(store.save(initial), /gewijzigd/);
  assert.deepEqual(store.snapshot(), saved);
});

test('opmerkingen wijzigen vereist beheerder en bewaart revisie- en sessieregels', async t => {
  const config = readConfig({});
  const store = createAccessStore([ADMIN], undefined, { revision: 0, users: [{ id: MEMBER, role: 'member' }] });
  const app = createTestApp(config, undefined, undefined, store);
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  config.port = (app.server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${config.port}`;
  const adminFetch = authenticatedFetch(await signIn(config));
  const memberFetch = authenticatedFetch(await signIn(config, MEMBER));
  const access = store.snapshot();
  const document = { ...access, users: access.users.map(user => ({ ...user, comment: user.id === ADMIN ? 'Vaste beheerder' : 'Chatteam' })) };
  const init = { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', 'X-Requested-With': 'faynominaal' },
    body: JSON.stringify(document) };
  assert.equal((await memberFetch(base + '/api/access', init)).status, 403);
  assert.deepEqual(store.snapshot(), access);
  const saved = await adminFetch(base + '/api/access', init);
  assert.equal(saved.status, 200);
  const result = await saved.json() as AccessSettings;
  assert.equal(result.users.find(user => user.id === ADMIN)?.comment, 'Vaste beheerder');
  assert.equal((await adminFetch(base + '/api/access', init)).status, 409);
  assert.equal((await memberFetch(base + '/api/config')).status, 200);
  assert.equal((await adminFetch(base + '/api/config')).status, 200);
});
