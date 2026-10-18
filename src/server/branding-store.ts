import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { maximumBrandingBodyBytes, maximumIconBytes } from '../shared/branding.ts';
import type { BrandingMetadata, BrandingUpdate } from '../shared/branding.ts';

export class BrandingError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function validateIcon(data: Buffer): void {
  if (data.length > maximumIconBytes) throw new BrandingError('Het verwerkte icoon mag maximaal 512 KiB zijn.', 413);
  const invalid = () => new BrandingError('Ongeldige PNG. Kies een afbeelding en probeer opnieuw.');
  if (data.length < 45 || !data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw invalid();
  let position = 8;
  let stride = 0;
  let height = 0;
  let ended = false;
  let imageEnded = false;
  const images: Buffer[] = [];
  while (position < data.length) {
    if (position + 12 > data.length || ended) throw invalid();
    const length = data.readUInt32BE(position);
    const end = position + 12 + length;
    if (end > data.length) throw invalid();
    const type = data.toString('ascii', position + 4, position + 8);
    if (!/^[A-Za-z]{4}$/.test(type) || data.readUInt32BE(end - 4) !== crc32(data.subarray(position + 4, end - 4))) throw invalid();
    const chunk = data.subarray(position + 8, end - 4);
    if (position === 8 && type !== 'IHDR') throw invalid();
    if (type === 'IHDR') {
      if (position !== 8 || length !== 13) throw invalid();
      const width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      const channels: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };
      const channelCount = channels[chunk[9]];
      if (!width || width > 256 || !height || height > 256 || chunk[8] !== 8 || !channelCount
        || chunk[10] || chunk[11] || chunk[12]) throw invalid();
      stride = width * channelCount + 1;
    } else if (type === 'IDAT') {
      if (imageEnded) throw invalid();
      images.push(chunk);
    } else if (type === 'IEND') {
      if (length || !images.length) throw invalid();
      ended = true;
    } else {
      if (images.length) imageEnded = true;
      if (type[0] === type[0].toUpperCase() || ['acTL', 'fcTL', 'fdAT'].includes(type)) throw invalid();
    }
    position = end;
  }
  if (!ended) throw invalid();
  try {
    const pixels = inflateSync(Buffer.concat(images), { maxOutputLength: stride * height });
    if (pixels.length !== stride * height) throw invalid();
    for (let row = 0; row < height; row++) if (pixels[row * stride] > 4) throw invalid();
  } catch { throw invalid(); }
}

function validate(value: unknown): BrandingUpdate {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BrandingError('Ongeldige icooninstellingen.');
  const body = value as Record<string, unknown>;
  if (Object.keys(body).length !== 2 || !Object.hasOwn(body, 'revision') || !Object.hasOwn(body, 'icon')
    || !Number.isSafeInteger(body.revision) || Number(body.revision) < 0 || (body.icon !== null && typeof body.icon !== 'string')) {
    throw new BrandingError('Ongeldige icooninstellingen.');
  }
  if (typeof body.icon === 'string') {
    if (body.icon.length > Math.ceil(maximumIconBytes / 3) * 4) throw new BrandingError('Het verwerkte icoon mag maximaal 512 KiB zijn.', 413);
    if (!body.icon.length || body.icon.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.icon)) throw new BrandingError('Ongeldige afbeeldingsgegevens.');
    const image = Buffer.from(body.icon, 'base64');
    if (image.toString('base64') !== body.icon) throw new BrandingError('Ongeldige afbeeldingsgegevens.');
    validateIcon(image);
  }
  return { revision: Number(body.revision), icon: body.icon as string | null };
}

export function fallbackIcon(username: string): Buffer {
  const initial = username.match(/[a-z0-9]/i)?.[0].toUpperCase() || 'F';
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><circle cx="128" cy="128" r="128" fill="#e73585"/><text x="128" y="132" fill="white" font-family="Arial,sans-serif" font-size="144" font-weight="700" text-anchor="middle" dominant-baseline="central">${initial}</text></svg>`);
}

export function createBrandingStore(path?: string, initial: BrandingUpdate = { revision: 0, icon: null }) {
  let document = validate(initial);
  let pending = Promise.resolve();
  const snapshot = (): BrandingMetadata => ({ revision: document.revision, hasIcon: document.icon !== null });
  return {
    snapshot,
    icon(username: string): { data: Buffer; type: string } {
      return document.icon ? { data: Buffer.from(document.icon, 'base64'), type: 'image/png' }
        : { data: fallbackIcon(username), type: 'image/svg+xml' };
    },
    save(value: unknown, authorized: () => boolean = () => true): Promise<BrandingMetadata> {
      const candidate = validate(value);
      const operation = pending.then(async () => {
        if (!authorized()) throw new BrandingError('Je beheerderstoegang is verlopen. Log opnieuw in.', 403);
        if (candidate.revision !== document.revision) throw new BrandingError('Het icoon is gewijzigd. Laad de huidige versie en probeer opnieuw.', 409);
        if (document.revision === Number.MAX_SAFE_INTEGER) throw new BrandingError('De icoonrevisie kan niet worden verhoogd.', 500);
        const next = { revision: document.revision + 1, icon: candidate.icon };
        if (path) {
          const temporary = `${path}.${randomUUID()}.tmp`;
          try {
            await mkdir(dirname(path), { recursive: true, mode: 0o700 });
            await writeFile(temporary, JSON.stringify(next) + '\n', { mode: 0o600, flag: 'wx' });
            await rename(temporary, path);
          } catch {
            await unlink(temporary).catch(() => {});
            throw new BrandingError('Opslaan op de server is mislukt. Het vorige icoon blijft actief.', 500);
          }
        }
        document = next;
        return snapshot();
      });
      pending = operation.then(() => {}, () => {});
      return operation;
    }
  };
}

export type BrandingStore = ReturnType<typeof createBrandingStore>;

export async function loadBrandingStore(path: string): Promise<BrandingStore> {
  try {
    const content = await readFile(path, 'utf8');
    if (Buffer.byteLength(content) > maximumBrandingBodyBytes) throw new Error('Te groot');
    return createBrandingStore(path, validate(JSON.parse(content)));
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return createBrandingStore(path);
    throw new Error('Kan data/branding.json niet lezen. Herstel dit bestand voordat de server wordt gestart.');
  }
}
