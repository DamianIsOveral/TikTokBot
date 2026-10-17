import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ensureSigningAssets } from './signing-assets.ts';
import { signingAssetPaths, validateSignedUrl, validateSigningInput } from './signing-profile.ts';
import type { DirectRequestSigner, SigningResult } from './signing-profile.ts';

export async function createHeadlessSigner(): Promise<DirectRequestSigner> {
  await ensureSigningAssets();
  let busy = false;
  return async input => {
    validateSigningInput(input);
    if (busy) throw new Error('Ondertekening is al bezig.');
    busy = true;
    try {
      const worker = fileURLToPath(new URL('./signing-worker.ts', import.meta.url));
      const readable = [worker, fileURLToPath(new URL('./signing-profile.ts', import.meta.url)),
        fileURLToPath(new URL('./upstream-signer.ts', import.meta.url)),
        fileURLToPath(new URL('./upstream-post-signer.ts', import.meta.url)), ...signingAssetPaths];
      readable.push(fileURLToPath(new URL('./moderation-spec.ts', import.meta.url)));
      const encoded = await new Promise<string>((resolve, reject) => {
        const child = spawn(process.execPath, ['--permission', '--max-old-space-size=64',
          ...readable.map(path => `--allow-fs-read=${path}`), worker], {
          windowsHide: true, env: { SystemRoot: process.env.SystemRoot || '' },
          stdio: ['pipe', 'pipe', 'ignore'], signal: AbortSignal.timeout(10_000)
        });
        let output = '';
        child.on('error', () => reject(new Error('Lokale ondertekening mislukt.')));
        child.stdout.on('data', (data: Buffer) => {
          output += data.toString('utf8');
          if (output.length > 32_768) { child.kill(); reject(new Error('Ongeldig ondertekeningsantwoord.')); }
        });
        child.on('close', code => code === 0 ? resolve(output) : reject(new Error('Lokale ondertekening mislukt.')));
        child.stdin.on('error', () => reject(new Error('Lokale ondertekening mislukt.')));
        child.stdin.end(JSON.stringify(input));
      });
      const result: SigningResult = JSON.parse(encoded);
      if (typeof result.signedUrl !== 'string' || !Number.isFinite(result.signMs) || result.signMs < 0
        || !Number.isFinite(result.rssMiB) || result.rssMiB <= 0) throw new Error('Ongeldig ondertekeningsantwoord.');
      validateSignedUrl(input, result.signedUrl);
      return result;
    } catch { throw new Error('Lokale ondertekening mislukt.'); }
    finally { busy = false; }
  };
}
