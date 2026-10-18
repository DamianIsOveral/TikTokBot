import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import { createFilterStore, loadFilterStore, FilterError } from '../src/server/filter-store.ts';
import { defaultFilterSettings, validFilterDocument } from '../src/shared/filter-settings.ts';
import { readConfig } from '../src/server/config.ts';
import { createAccessStore } from '../src/server/auth/access-store.ts';
import { ADMIN, MEMBER, createTestApp, signIn, authenticatedFetch } from './auth-fixture.ts';

test('filters valideren revisie, drie schakelaars en een begrensde woordenlijst', () => {
  const initial = { revision: 0, settings: { ...defaultFilterSettings } };
  assert.ok(validFilterDocument(initial));
  assert.ok(validFilterDocument({ ...initial, settings: { ...initial.settings, words: '' } }));
  for (const value of [null, [], {}, { ...initial, revision: -1 }, { ...initial, revision: 1.5 },
    { ...initial, revision: Number.MAX_SAFE_INTEGER + 1 }, { ...initial, extra: true },
    { ...initial, settings: { ...initial.settings, links: 'true' } },
    { ...initial, settings: { ...initial.settings, spam: null } },
    { ...initial, settings: { ...initial.settings, swearing: 1 } },
    { ...initial, settings: { ...initial.settings, words: 'x'.repeat(4001) } },
    ...['\n', '\r', '\t', '\0', '\u007f', '\u0085', '\u202e', '\ud800'].map(words => ({ ...initial, settings: { ...initial.settings, words } })),
    { ...initial, settings: { ...initial.settings, mute: true } }]) {
    assert.equal(validFilterDocument(value), false);
    assert.throws(() => createFilterStore(undefined, value as typeof initial), FilterError);
  }
});

test('browserfilters volgen gedeelde versies, bewaren de actieve referentie en weigeren stale writes', async t => {
  const filters = await import(new URL('../dist/browser/client/filters.js', import.meta.url).href);
  const active = filters.loadSettings();
  const document = { revision: 4, settings: { links: false, spam: false, swearing: true, words: 'globaal' } };
  let renders = 0;
  let notifications = 0;
  const unsubscribe = filters.subscribeGlobalFilters(() => { notifications++; });
  t.after(unsubscribe);
  let reply: typeof globalThis.fetch = async () => Response.json(document);
  t.mock.method(globalThis, 'fetch', (input: Parameters<typeof fetch>[0], init?: RequestInit) => reply(input, init));
  await filters.initializeGlobalFilters(() => { renders++; });
  assert.equal(active, filters.loadSettings());
  assert.deepEqual(active, document.settings);
  assert.equal(renders, 1);
  assert.equal(notifications, 1);
  assert.equal(filters.applyGlobalFilters({ ...document, revision: 3 }), false);
  assert.equal(filters.applyGlobalFilters({ ...document, settings: { links: true } }), false);
  const newer = { revision: 5, settings: { ...document.settings, words: 'nieuwer' } };
  assert.equal(filters.applyGlobalFilters(newer), true);
  const fetched = await filters.fetchGlobalFilters();
  assert.deepEqual(fetched, newer);
  assert.deepEqual(active, newer.settings);
  reply = async (_url, init) => {
    assert.equal(init?.method, 'POST');
    assert.equal((init?.headers as Record<string, string>)['X-Requested-With'], 'faynominaal');
    assert.deepEqual(JSON.parse(String(init?.body)), { revision: 4, settings: document.settings });
    return Response.json({ error: 'Nieuwe versie', currentRevision: 5 }, { status: 409 });
  };
  await assert.rejects(filters.saveSettings(document.settings, 4), (error: { status: number }) => error.status === 409);
  assert.deepEqual(active, newer.settings);
  reply = async () => Response.json({ revision: 6, settings: document.settings });
  const saved = await filters.saveSettings(document.settings, 5);
  assert.equal(saved.revision, 6);
  assert.deepEqual(active, document.settings);
});

test('filters worden atomair gedeeld opgeslagen, herladen en tegen gelijktijdig overschrijven beschermd', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'fay-filters-'));
  assert.ok(directory.startsWith(join(tmpdir(), 'fay-filters-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'filters.json');
  const store = await loadFilterStore(path);
  const original = store.snapshot();
  original.settings.words = 'geen mutatie';
  assert.equal(store.snapshot().settings.words, defaultFilterSettings.words);
  const draft = { revision: 0, settings: { links: false, spam: true, swearing: false, words: 'voorbeeld' } };
  const results = await Promise.allSettled([store.save(draft), store.save(draft)]);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].status, 'rejected');
  if (results[1].status === 'rejected') assert.equal((results[1].reason as FilterError).status, 409);
  const current = { ...draft, revision: 1 };
  assert.deepEqual((await loadFilterStore(path)).snapshot(), current);
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), current);
  assert.deepEqual(await readdir(directory), ['filters.json']);
  assert.throws(() => store.save({ ...current, settings: { ...draft.settings, links: 1 } }));
  assert.deepEqual(store.snapshot(), current);
  const blocked = join(directory, 'blocked');
  await writeFile(blocked, 'file');
  const failing = createFilterStore(join(blocked, 'filters.json'));
  await assert.rejects(failing.save(failing.snapshot()), (error: FilterError) => error.status === 500);
  assert.equal(failing.snapshot().revision, 0);
  await writeFile(path, '{kapot');
  await assert.rejects(loadFilterStore(path), /Herstel dit bestand/);
  await writeFile(path, 'x'.repeat(33 * 1024));
  await assert.rejects(loadFilterStore(path), /Herstel dit bestand/);
  const exhausted = createFilterStore(undefined, { ...current, revision: Number.MAX_SAFE_INTEGER });
  await assert.rejects(exhausted.save(exhausted.snapshot()), (error: FilterError) => error.status === 500);
});

test('globale filters-API vereist login en CSRF, laat leden opslaan en deelt nieuwe versies', { timeout: 10_000 }, async t => {
  const config = readConfig({});
  const access = createAccessStore([ADMIN], undefined, { revision: 0, users: [{ id: MEMBER, role: 'member' }] });
  const app = createTestApp(config, undefined, undefined, access);
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  config.port = (app.server.address() as AddressInfo).port;
  t.after(() => app.close());
  const base = `http://127.0.0.1:${config.port}`;
  const url = base + '/api/filters';
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(url, { method: 'POST' })).status, 401);
  const member = authenticatedFetch(await signIn(config, MEMBER));
  const admin = authenticatedFetch(await signIn(config));
  const initial = await (await member(url)).json();
  assert.deepEqual(initial, { revision: 0, settings: defaultFilterSettings });
  assert.deepEqual((await (await member(base + '/api/snapshot')).json()).filters, initial);
  const post = (value: unknown, extra: Record<string, string> = {}) => member(url, {
    method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', 'X-Requested-With': 'faynominaal', ...extra },
    body: JSON.stringify(value)
  });
  assert.equal((await member(url, { method: 'POST' })).status, 403);
  assert.equal((await post(initial, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await post(initial, { 'X-Requested-With': '' })).status, 403);
  assert.equal((await member(url, { method: 'PUT' })).status, 405);
  assert.equal((await post(initial, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await post({ ...initial, settings: { ...initial.settings, words: '\0' } })).status, 400);
  assert.equal((await post({ blob: 'x'.repeat(130 * 1024) })).status, 413);
  const controller = new AbortController();
  t.after(() => controller.abort());
  const stream = await admin(base + '/api/events', { signal: controller.signal });
  const reader = stream.body!.getReader();
  const firstFrame = new TextDecoder().decode((await reader.read()).value);
  assert.deepEqual(JSON.parse(firstFrame.slice(6).trim()).filters, initial);
  const next = { revision: 0, settings: { links: false, spam: false, swearing: true, words: 'voorbeeld' } };
  const saved = await post(next);
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), { ...next, revision: 1 });
  const changedFrame = new TextDecoder().decode((await reader.read()).value);
  assert.deepEqual(JSON.parse(changedFrame.slice(6).trim()), { type: 'filters-changed', value: { ...next, revision: 1 } });
  await reader.cancel();
  assert.deepEqual(await (await admin(url)).json(), { ...next, revision: 1 });
  const conflict = await post(initial);
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).currentRevision, 1);
  assert.deepEqual(await (await member(url)).json(), { ...next, revision: 1 });
});
