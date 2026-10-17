import { fileURLToPath } from 'node:url';

export const signingSdkVersion = '1.0.0.417';
export const signingAssets = [
  {
    name: 'bootstrap.js',
    url: 'https://raw.githubusercontent.com/nglmercer/tiktok-signer/a94d9d26602163a0f4e0e88ce26c633c6f50a034/packages/tiktok-live/vendor/bootstrap.js',
    sha256: '3a7ccf4b219e7d74689d1567c73cb528ccaa96ae6f43c0b23d8fb13a70e3ebd2'
  },
  {
    name: 'webmssdk-1.0.0.417.js',
    url: 'https://sf16-website-login.neutral.tiktokcdn-eu.com/obj/tiktok_web_login_static_eu/webmssdk/1.0.0.417/webmssdk.js',
    sha256: '6625c4fd90012eb2b6166002b278ac99ba2a2495325590f8eda9071544a814c8'
  }
] as const;
export const signingDirectory = new URL('../../../.local-archive/signing-research/', import.meta.url);
export const signingUserAgent = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
export const signingFields = ['X-Dynosaur', 'msToken', 'X-Bogus', 'X-Gnarly'] as const;
export const signingAssetPaths = signingAssets.map(asset => fileURLToPath(new URL(asset.name, signingDirectory)));

export interface SigningInput { url: string; userAgent: string; msToken?: string }
export interface SigningResult { signedUrl: string; signMs: number; rssMiB: number }
export type DirectRequestSigner = (input: SigningInput) => Promise<SigningResult>;

export function assertSigningVersion(html: string): void {
  const versions = new Set([...html.matchAll(/\/webmssdk\/([\d.]{1,32})\/webmssdk\.js/g)].map(match => match[1]));
  if (versions.size !== 1 || !versions.has(signingSdkVersion)) {
    throw new Error('De LIVE-pagina gebruikt geen eenduidige, vastgelegde ondertekeningsversie.');
  }
}

export function validateSigningInput(input: SigningInput): void {
  const url = new URL(input.url);
  if (url.origin !== 'https://webcast.tiktok.com' || url.pathname !== '/webcast/room/chat/'
    || url.username || url.password || url.hash || input.url.length > 8192
    || !/^\d{10,25}$/.test(url.searchParams.get('room_id') || '')
    || signingFields.some(name => url.searchParams.has(name))
    || !input.userAgent || input.userAgent.length > 512 || /[\r\n]/.test(input.userAgent)
    || (input.msToken !== undefined && (!/^[\w=+/-]{1,1024}$/.test(input.msToken)))) {
    throw new Error('Ongeldige invoer voor de lokale ondertekening.');
  }
}

export function validateSignedUrl(input: SigningInput, signedUrl: string): void {
  validateSigningInput(input);
  const prefix = `${input.url}&`;
  if (signedUrl.length > 16_384 || !signedUrl.startsWith(prefix)) throw new Error('Ongeldige ondertekening.');
  const added = new URLSearchParams(signedUrl.slice(prefix.length));
  if ([...added].length !== signingFields.length || signingFields.some(name => added.getAll(name).length !== 1)
    || signingFields.filter(name => name !== 'msToken').some(name => !added.get(name))) {
    throw new Error('Onvolledige ondertekening.');
  }
}
