import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { deflateSync } from 'node:zlib';
import type { AddressInfo } from 'node:net';
import { BrandingError, createBrandingStore, fallbackIcon, loadBrandingStore, validateIcon } from '../src/server/branding-store.ts';
import { maximumBrandingBodyBytes, maximumIconBytes, validBrandingMetadata } from '../src/shared/branding.ts';
import { createAccessStore } from '../src/server/auth/access-store.ts';
import { readConfig } from '../src/server/config.ts';
import { ADMIN, MEMBER, authenticatedFetch, createTestApp, signIn } from './auth-fixture.ts';

function chunk(type: string, content = Buffer.alloc(0)): Buffer {
  const result = Buffer.alloc(content.length + 12);
  result.writeUInt32BE(content.length);
  result.write(type, 4, 'ascii');
  content.copy(result, 8);
  let crc = 0xffffffff;
  for (const byte of result.subarray(4, result.length - 4)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
  return result;
}
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function png(width = 1, height = 1, options: { color?: number; depth?: number; filter?: number; pixels?: Buffer; before?: Buffer[]; after?: Buffer[]; interlace?: number } = {}): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4);
  header[8] = options.depth ?? 8;
  header[9] = options.color ?? 6;
  header[12] = options.interlace ?? 0;
  const pixels = options.pixels ?? Buffer.alloc((width * 4 + 1) * height);
  if (options.filter !== undefined) pixels[0] = options.filter;
  return Buffer.concat([signature, chunk('IHDR', header), ...(options.before || []), chunk('IDAT', deflateSync(pixels)),
    ...(options.after || []), chunk('IEND')]);
}
const image = png();
const icon = image.toString('base64');

function detailedIcon(): Buffer {
  const pixels = Buffer.alloc(256 * 1025);
  let state = 5341;
  for (let position = 0; position < pixels.length; position++) {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    pixels[position] = position % 1025 ? state & 255 : 0;
  }
  return png(256, 256, { pixels });
}

test('branding validates actual bounded PNG raster data and safe metadata', () => {
  validateIcon(image);
  validateIcon(png(256, 256));
  validateIcon(png(2, 3, { before: [chunk('sRGB', Buffer.from([0]))] }));
  for (const color of [0, 2, 4]) {
    validateIcon(png(1, 1, { color, pixels: Buffer.alloc(({ 0: 1, 2: 3, 4: 2 }[color]! + 1)) }));
  }
  const corrupt = Buffer.from(image); corrupt[corrupt.length - 1] ^= 1;
  const invalid = [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), Buffer.from('<html>no</html>'),
    Buffer.alloc(maximumIconBytes + 1), Buffer.concat([image, Buffer.from('trailing')]), corrupt,
    png(0), png(257), png(1, 257), png(1, 0), png(1, 1, { depth: 16 }), png(1, 1, { color: 3 }),
    png(1, 1, { interlace: 1 }), png(1, 1, { filter: 5 }), png(1, 1, { pixels: Buffer.alloc(6) }),
    png(1, 1, { pixels: Buffer.alloc(4) }), png(1, 1, { before: [chunk('PLTE')] }),
    png(1, 1, { before: [chunk('acTL')] }), png(1, 1, { before: [chunk('bad!')] }),
    image.subarray(0, image.length - 1), image.subarray(0, image.length - 12),
    Buffer.concat([signature, chunk('IEND')]), Buffer.concat([signature, chunk('IDAT'), chunk('IEND')]),
    png(1, 1, { after: [chunk('tEXt'), chunk('IDAT', deflateSync(Buffer.alloc(5)))] }),
    Buffer.concat([image.subarray(0, image.length - 12), chunk('IEND', Buffer.from([0]))])];
  for (const value of invalid) assert.throws(() => validateIcon(value), BrandingError);
  for (const value of [null, [], {}, { revision: 0, icon }, { revision: -1, hasIcon: true },
    { revision: 1.5, hasIcon: false }, { revision: 0, hasIcon: 'yes' }]) assert.equal(validBrandingMetadata(value), false);
  assert.equal(validBrandingMetadata({ revision: 0, hasIcon: false }), true);
  assert.match(fallbackIcon('@example').toString(), />E<\/text>/);
  assert.match(fallbackIcon('!').toString(), />F<\/text>/);
  assert.doesNotMatch(fallbackIcon('</text><script>alert(1)</script>').toString(), /<script>/);
});

test('branding persists a single atomic document and protects revisions and failed writes', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'fay-branding-'));
  assert.ok(directory.startsWith(join(tmpdir(), 'fay-branding-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'branding.json');
  const store = await loadBrandingStore(path);
  assert.deepEqual(store.snapshot(), { revision: 0, hasIcon: false });
  assert.equal(store.icon('foo').type, 'image/svg+xml');
  const results = await Promise.allSettled([store.save({ revision: 0, icon }), store.save({ revision: 0, icon })]);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].status, 'rejected');
  if (results[1].status === 'rejected') assert.equal((results[1].reason as BrandingError).status, 409);
  assert.deepEqual(store.snapshot(), { revision: 1, hasIcon: true });
  const snapshot = store.snapshot(); snapshot.revision = 20;
  assert.equal(store.snapshot().revision, 1);
  assert.equal(store.icon('foo').type, 'image/png');
  assert.deepEqual(store.icon('foo').data, image);
  const retrieved = store.icon('foo').data; retrieved[0] = 0;
  assert.deepEqual(store.icon('foo').data, image);
  assert.deepEqual((await loadBrandingStore(path)).snapshot(), store.snapshot());
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { revision: 1, icon });
  assert.deepEqual(await readdir(directory), ['branding.json']);
  await assert.rejects(store.save({ revision: 1, icon: null }, () => false), (error: BrandingError) => error.status === 403);
  assert.equal(store.snapshot().revision, 1);
  await store.save({ revision: 1, icon: null });
  assert.deepEqual((await loadBrandingStore(path)).snapshot(), { revision: 2, hasIcon: false });
  assert.equal(store.icon('foo').type, 'image/svg+xml');
  const blocked = join(directory, 'blocked');
  await writeFile(blocked, 'file');
  const failing = createBrandingStore(join(blocked, 'branding.json'));
  await assert.rejects(failing.save({ revision: 0, icon }), (error: BrandingError) => error.status === 500);
  assert.deepEqual(failing.snapshot(), { revision: 0, hasIcon: false });
  await writeFile(path, '{invalid');
  await assert.rejects(loadBrandingStore(path), /Herstel dit bestand/);
  await writeFile(path, 'x'.repeat(maximumBrandingBodyBytes + 1));
  await assert.rejects(loadBrandingStore(path), /Herstel dit bestand/);
  const exhausted = createBrandingStore(undefined, { revision: Number.MAX_SAFE_INTEGER, icon: null });
  await assert.rejects(exhausted.save({ revision: Number.MAX_SAFE_INTEGER, icon: null }), (error: BrandingError) => error.status === 500);
});

test('branding rejects malformed documents before they can change the active image', () => {
  const store = createBrandingStore();
  for (const value of [null, [], {}, { revision: -1, icon: null }, { revision: 0.5, icon: null },
    { revision: 0, icon: false }, { revision: 0, icon, extra: true }, { revision: 0, icon: '' },
    { revision: 0, icon: '!!!!' }, { revision: 0, icon: 'a===' }, { revision: 0, icon: 'AA' },
    { revision: 0, icon: 'AB==' }, { revision: 0, icon: 'eA==' },
    { revision: 0, icon: 'x'.repeat(Math.ceil(maximumIconBytes / 3) * 4 + 1) }]) {
    assert.throws(() => store.save(value), BrandingError);
  }
  assert.deepEqual(store.snapshot(), { revision: 0, hasIcon: false });
});

test('shared branding API requires login, administrator mutations and CSRF; public image has fixed MIME', { timeout: 10_000 }, async t => {
  const config = readConfig({});
  const access = createAccessStore([ADMIN], undefined, { revision: 0, users: [{ id: MEMBER, role: 'member' }] });
  const app = createTestApp(config, undefined, undefined, access);
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  config.port = (app.server.address() as AddressInfo).port;
  t.after(() => app.close());
  const base = `http://127.0.0.1:${config.port}`;
  const url = base + '/api/branding';
  const publicImage = await fetch(base + '/branding/icon?revision=0');
  assert.equal(publicImage.status, 200);
  assert.equal(publicImage.headers.get('content-type'), 'image/svg+xml');
  assert.equal(publicImage.headers.get('x-content-type-options'), 'nosniff');
  assert.match(await publicImage.text(), /<svg /);
  assert.equal((await fetch(base + '/branding/icon', { method: 'HEAD' })).status, 200);
  assert.equal((await fetch(base + '/branding/icon', { method: 'POST' })).status, 405);
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(url, { method: 'POST' })).status, 401);
  const member = authenticatedFetch(await signIn(config, MEMBER));
  const admin = authenticatedFetch(await signIn(config));
  assert.deepEqual(await (await member(url)).json(), { revision: 0, hasIcon: false });
  const post = (value: unknown, headers: Record<string, string> = {}, send = admin) => send(url, { method: 'POST',
    headers: { Origin: base, 'Content-Type': 'application/json', 'X-Requested-With': 'faynominaal', ...headers }, body: JSON.stringify(value) });
  assert.equal((await post({ revision: 0, icon }, {}, member)).status, 403);
  assert.equal((await admin(url, { method: 'POST' })).status, 403);
  assert.equal((await post({ revision: 0, icon }, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await post({ revision: 0, icon }, { 'X-Requested-With': '' })).status, 403);
  assert.equal((await admin(url, { method: 'PUT' })).status, 405);
  assert.equal((await post({ revision: 0, icon }, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await post({ revision: 0, icon: Buffer.from('<svg/>').toString('base64') })).status, 400);
  assert.equal((await post({ revision: 0, icon: 'x'.repeat(maximumBrandingBodyBytes) })).status, 413);
  const invalidJson = await admin(url, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', 'X-Requested-With': 'faynominaal' }, body: '{' });
  assert.equal(invalidJson.status, 400);
  const detailed = detailedIcon();
  assert.ok(detailed.length > 128 * 1024 && detailed.length < maximumIconBytes);
  const saved = await post({ revision: 0, icon: detailed.toString('base64') });
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), { revision: 1, hasIcon: true });
  assert.deepEqual(await (await member(url)).json(), { revision: 1, hasIcon: true });
  const uploaded = await fetch(base + '/branding/icon?revision=1');
  assert.equal(uploaded.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await uploaded.arrayBuffer()), detailed);
  const stale = await post({ revision: 0, icon: null });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).currentRevision, 1);
  assert.equal((await post({ revision: 1, icon: null })).status, 200);
  assert.equal((await fetch(base + '/branding/icon')).headers.get('content-type'), 'image/svg+xml');
});
