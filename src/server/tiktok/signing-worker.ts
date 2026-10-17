import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { signingAssets, signingAssetPaths, signingDirectory, validateSignedUrl, validateSigningInput } from './signing-profile.ts';
import { importUpstreamSigner, signWithUpstream } from './upstream-signer.ts';
import { signPostWithUpstream } from './upstream-post-signer.ts';
import type { SigningInput } from './signing-profile.ts';

try {
  let text = '';
  for await (const chunk of process.stdin) {
    text += chunk;
    if (text.length > 32_768) throw new Error();
  }
  const input: SigningInput = JSON.parse(text);
  validateSigningInput(input);
  const sources = signingAssets.map((asset, index) => {
    const path = signingAssetPaths[index];
    if (statSync(path).size > 1_048_576) throw new Error();
    const source = readFileSync(path);
    if (!source.length || createHash('sha256').update(source).digest('hex') !== asset.sha256) throw new Error();
    return source.toString('utf8');
  });
  globalThis.fetch = async () => { throw new Error('Netwerk is niet beschikbaar in de ondertekenaar.'); };
  const start = performance.now();
  const signedUrl = input.method === 'POST' ? signPostWithUpstream(sources[0], sources[1], input)
    : await signWithUpstream(await importUpstreamSigner(new URL('upstream/src/', signingDirectory)), sources[1], input);
  validateSignedUrl(input, signedUrl);
  process.stdout.write(JSON.stringify({ signedUrl, signMs: performance.now() - start, rssMiB: process.memoryUsage().rss / 1_048_576 }));
} catch {
  process.stdout.write('{"error":"signing"}');
  process.exitCode = 1;
}
