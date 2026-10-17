import { registerHooks } from 'node:module';
import type { SigningInput } from './signing-profile.ts';

export interface UpstreamSigner {
  sign(url: string, product: string): string;
}
export interface UpstreamSignerModule {
  Signer: { create(options: { bundleSource: string; userAgent: string; cookie: string; storedToken?: string; pinned: boolean }): Promise<UpstreamSigner> };
  PRODUCT: { fetch: string };
}

export async function importUpstreamSigner(sourceDirectory: URL): Promise<UpstreamSignerModule> {
  const signerUrl = new URL('signer.ts', sourceDirectory).href;
  const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
    if (context.parentURL === signerUrl && ['./http.js', './session.js'].includes(specifier)) {
      return { url: new URL(specifier.replace(/\.js$/, '.ts'), sourceDirectory).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  } });
  try {
    const upstream: UpstreamSignerModule = await import(signerUrl);
    if (typeof upstream.Signer?.create !== 'function' || upstream.PRODUCT?.fetch !== 'fetch') throw new Error();
    return upstream;
  } finally { hooks.deregister(); }
}

export async function signWithUpstream(upstream: UpstreamSignerModule, source: string, input: SigningInput,
  pinned = false): Promise<string> {
  const signer = await upstream.Signer.create({ bundleSource: source, userAgent: input.userAgent,
    cookie: input.cookie || '', storedToken: input.msToken, pinned });
  return signer.sign(input.url, upstream.PRODUCT.fetch);
}
