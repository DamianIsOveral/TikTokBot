import { readFileSync, statSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import vm from 'node:vm';
import { signingAssets, signingAssetPaths, validateSignedUrl, validateSigningInput } from './signing-profile.ts';
import type { SigningInput } from './signing-profile.ts';

try {
  let text = '';
  for await (const chunk of process.stdin) {
    text += chunk;
    if (text.length > 16_384) throw new Error();
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
  const context = vm.createContext({
    __ttl_random_bytes: (n: number) => {
      if (!Number.isInteger(n) || n < 0 || n > 65_536) throw new Error();
      return [...randomBytes(n)];
    }
  }, { microtaskMode: 'afterEvaluate' });
  new vm.Script(sources[0]).runInContext(context, { timeout: 3000 });
  context.bundle = sources[1];
  context.options = JSON.stringify({ pinned: false, userAgent: input.userAgent, xmst: input.msToken });
  const prepared = JSON.parse(vm.runInContext('ttlPrepare(bundle, options)', context, { timeout: 3000 }));
  if (prepared.ok !== true) throw new Error();
  delete context.bundle;
  delete context.options;
  context.url = input.url;
  const start = performance.now();
  vm.runInContext('__ttlCaptured=null; __ttlPrepared.w.fetch(url, {method:"POST", body:""})', context, { timeout: 3000 });
  const signedUrl: unknown = context.__ttlCaptured;
  if (typeof signedUrl !== 'string') throw new Error();
  validateSignedUrl(input, signedUrl);
  process.stdout.write(JSON.stringify({ signedUrl, signMs: performance.now() - start, rssMiB: process.memoryUsage().rss / 1_048_576 }));
} catch {
  process.stdout.write('{"error":"signing"}');
  process.exitCode = 1;
}
