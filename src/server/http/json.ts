import type { IncomingMessage } from 'node:http';
import { CommandError } from '../command-validation.ts';

export async function readJson(req: IncomingMessage): Promise<unknown> {
  if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
    req.resume();
    throw new CommandError('Verstuur application/json.', 415);
  }
  return new Promise((resolve, reject) => {
    let size = 0;
    let failed = false;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      if (failed) return;
      size += chunk.length;
      if (size > 128 * 1024) {
        failed = true;
        chunks.length = 0;
        reject(new CommandError('De configuratie is te groot.', 413));
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      if (failed) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new CommandError('Ongeldige JSON.')); }
    });
    req.on('error', () => reject(new CommandError('Verzoek onderbroken.')));
    req.on('aborted', () => reject(new CommandError('Verzoek onderbroken.')));
  });
}
