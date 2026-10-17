import vm from 'node:vm';
import { validateSignedUrl, validateSigningInput } from './signing-profile.ts';
import type { SigningInput } from './signing-profile.ts';

// Upstream sign(url) forces GET. This bridge gives its unchanged bootstrap the actual POST body.
export function signPostWithUpstream(bootstrap: string, bundle: string, input: SigningInput, pinned = false): string {
  validateSigningInput(input);
  if (input.method !== 'POST' || typeof input.body !== 'string') throw new Error('POST-context ontbreekt.');
  const context = vm.createContext({});
  const options = { timeout: 3000 };
  new vm.Script(bootstrap).runInContext(context, options);
  context.__bundle = bundle;
  context.__options = JSON.stringify({ userAgent: input.userAgent, cookie: input.cookie || '', xmst: input.msToken, pinned });
  const prepared = JSON.parse(vm.runInContext('ttlPrepare(__bundle, __options)', context, options));
  delete context.__bundle;
  delete context.__options;
  if (prepared?.ok !== true || prepared.error) throw new Error('Ondertekenaar niet gereed.');
  context.__url = input.url;
  context.__body = input.body;
  context.__contentType = input.contentType || 'application/json';
  const signed: unknown = vm.runInContext(`
    __ttlCaptured = null;
    __ttlPrepared.w.fetch(__url, {
      method: 'POST', body: __body, headers: { 'Content-Type': __contentType }
    });
    __ttlCaptured;
  `, context, options);
  if (typeof signed !== 'string') throw new Error('Ondertekenaar gaf geen URL.');
  validateSignedUrl(input, signed);
  return signed;
}
