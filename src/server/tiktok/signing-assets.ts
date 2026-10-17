import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { signingAssets, signingAssetPaths, signingDirectory } from './signing-profile.ts';

export function verifySigningAsset(source: Uint8Array, expected: string): void {
  if (!source.length || source.length > 1_048_576 || createHash('sha256').update(source).digest('hex') !== expected) {
    throw new Error('Ondertekeningsbestand wijkt af van de vastgelegde versie.');
  }
}

export async function ensureSigningAssets(request: typeof fetch = fetch): Promise<void> {
  await mkdir(signingDirectory, { recursive: true });
  for (const [index, asset] of signingAssets.entries()) {
    const path = signingAssetPaths[index];
    try {
      if ((await stat(path)).size > 1_048_576) throw new Error('Ondertekeningsbestand is te groot.');
      verifySigningAsset(await readFile(path), asset.sha256);
      continue;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const signal = AbortSignal.timeout(15_000);
    const response = await request(asset.url, { redirect: 'error', signal });
    if (!response.ok || !response.body) throw new Error('Ondertekeningsbestand niet bereikbaar.');
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > 1_048_576) throw new Error('Ondertekeningsbestand is te groot.');
      chunks.push(chunk);
    }
    const source = Buffer.concat(chunks);
    verifySigningAsset(source, asset.sha256);
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(temporary, source, { flag: 'wx', mode: 0o600 });
      await rename(temporary, path);
    } finally { await unlink(temporary).catch(() => {}); }
  }
}
