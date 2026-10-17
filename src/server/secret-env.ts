import { openSync, readSync, closeSync, fstatSync } from 'node:fs';

const keys = ['DISCORD_CLIENT_SECRET', 'EULER_API_KEY', 'TIKTOK_SESSION_ID', 'TIKTOK_MS_TOKEN', 'TIKTOK_VERIFY_FP', 'TIKTOK_TARGET_IDC'];
export function readSecretEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result = { ...env };
  for (const key of keys) {
    const path = env[`${key}_FILE`];
    if (!path) continue;
    if (env[key]) throw new Error(`Gebruik ${key} of ${key}_FILE, niet beide.`);
    try {
      const descriptor = openSync(path, 'r');
      const buffer = Buffer.alloc(8193);
      let size = 0;
      try {
        if (!fstatSync(descriptor).isFile()) throw new Error();
        while (size < buffer.length) {
          const count = readSync(descriptor, buffer, size, buffer.length - size, null);
          if (!count) break;
          size += count;
        }
      } finally { closeSync(descriptor); }
      if (size > 8192) throw new Error();
      const value = buffer.subarray(0, size).toString('utf8').trim();
      if (!value || /[\r\n\x00]/.test(value)) throw new Error();
      result[key] = value;
      delete result[`${key}_FILE`];
    } catch { throw new Error(`${key}_FILE kan niet als begrensd secretbestand worden gelezen.`); }
  }
  return result;
}
