import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSecretEnvironment } from '../src/server/secret-env.ts';

async function temporary(t: TestContext): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'faynominaal-secret-test-'));
  t.after(async () => { await rm(path, { recursive: true, force: true }); });
  return path;
}

test('gemonteerde secretbestanden werken voor uitsluitend bekende keys en muteren de caller niet', async t => {
  const root = await temporary(t);
  const keys = ['DISCORD_CLIENT_SECRET', 'EULER_API_KEY', 'TIKTOK_SESSION_ID', 'TIKTOK_MS_TOKEN', 'TIKTOK_VERIFY_FP', 'TIKTOK_TARGET_IDC'];
  const env: NodeJS.ProcessEnv = { HOST: '127.0.0.1', UNKNOWN_FILE: '/not/read/by/this/helper' };
  for (const [index, key] of keys.entries()) {
    const path = join(root, `fake-${index}`);
    await writeFile(path, `FAKE_SECRET_${index}\n`, { mode: 0o600 });
    env[`${key}_FILE`] = path;
  }
  const original = { ...env };
  const result = readSecretEnvironment(env);
  assert.notEqual(result, env); assert.deepEqual(env, original);
  for (const [index, key] of keys.entries()) {
    assert.equal(result[key], `FAKE_SECRET_${index}`);
    assert.equal(result[`${key}_FILE`], undefined);
  }
  assert.equal(result.HOST, env.HOST); assert.equal(result.UNKNOWN_FILE, env.UNKNOWN_FILE);
});

test('secret komt uit waarde of bestand; beide tegelijk worden geweigerd zonder informatie te lekken', async t => {
  const root = await temporary(t);
  const path = join(root, 'PRIVATE_PATH');
  await writeFile(path, 'PRIVATE_FILE_VALUE');
  const env = { DISCORD_CLIENT_SECRET: 'PRIVATE_ENV_VALUE', DISCORD_CLIENT_SECRET_FILE: path };
  assert.throws(() => readSecretEnvironment(env), error => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, 'Gebruik DISCORD_CLIENT_SECRET of DISCORD_CLIENT_SECRET_FILE, niet beide.');
    assert.ok(!/PRIVATE|faynominaal-secret-test/.test(error.message));
    return true;
  });
  assert.equal(readSecretEnvironment({ DISCORD_CLIENT_SECRET: 'FAKE_DIRECT' }).DISCORD_CLIENT_SECRET, 'FAKE_DIRECT');
  assert.equal(readSecretEnvironment({ DISCORD_CLIENT_SECRET: '', DISCORD_CLIENT_SECRET_FILE: path }).DISCORD_CLIENT_SECRET, 'PRIVATE_FILE_VALUE');
  assert.deepEqual(env, { DISCORD_CLIENT_SECRET: 'PRIVATE_ENV_VALUE', DISCORD_CLIENT_SECRET_FILE: path });
});

test('lege, meerregelige, NUL- en te grote secretbestanden geven uitsluitend een vaste fout', async t => {
  const root = await temporary(t);
  const path = join(root, 'PRIVATE_PATH');
  for (const value of ['', '  \r\n  ', 'PRIVATE_VALUE\nINJECTED', 'PRIVATE_VALUE\rINJECTED', 'PRIVATE_VALUE\0INJECTED', 'x'.repeat(8193)]) {
    await writeFile(path, value);
    const env = { TIKTOK_SESSION_ID_FILE: path };
    assert.throws(() => readSecretEnvironment(env), error => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, 'TIKTOK_SESSION_ID_FILE kan niet als begrensd secretbestand worden gelezen.');
      assert.ok(!/PRIVATE|INJECTED|faynominaal-secret-test/.test(error.message));
      return true;
    });
    assert.deepEqual(env, { TIKTOK_SESSION_ID_FILE: path });
  }
  await writeFile(path, 'x'.repeat(8192));
  assert.equal(readSecretEnvironment({ TIKTOK_SESSION_ID_FILE: path }).TIKTOK_SESSION_ID?.length, 8192);
  await writeFile(path, '  FAKE_VALUE\r\n');
  assert.equal(readSecretEnvironment({ TIKTOK_SESSION_ID_FILE: path }).TIKTOK_SESSION_ID, 'FAKE_VALUE');
});

test('ontbrekende bestanden onthullen geen pad en een latere fout laat eerdere invoer ongewijzigd', async t => {
  const root = await temporary(t);
  const valid = join(root, 'fake-valid'); await writeFile(valid, 'PRIVATE_VALUE');
  const missing = join(root, 'PRIVATE_MISSING_PATH');
  const env = { DISCORD_CLIENT_SECRET_FILE: valid, EULER_API_KEY_FILE: missing };
  assert.throws(() => readSecretEnvironment(env), error => error instanceof Error
    && error.message === 'EULER_API_KEY_FILE kan niet als begrensd secretbestand worden gelezen.');
  assert.deepEqual(env, { DISCORD_CLIENT_SECRET_FILE: valid, EULER_API_KEY_FILE: missing });
  assert.deepEqual(readSecretEnvironment({}), {});
});
