import { mkdir, readFile, rename, writeFile, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { defaultFilterSettings, validFilterDocument } from '../shared/filter-settings.ts';
import type { FilterDocument } from '../shared/filter-settings.ts';

export class FilterError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

function validate(value: unknown): FilterDocument {
  if (!validFilterDocument(value)) {
    throw new FilterError('Ongeldige filters. Gebruik drie aan/uit-instellingen en een woordenlijst van maximaal 4000 tekens zonder besturingstekens.');
  }
  return structuredClone(value);
}

export function createFilterStore(path?: string, initial: FilterDocument = { revision: 0, settings: { ...defaultFilterSettings } }) {
  let document = validate(initial);
  let pending = Promise.resolve();
  return {
    snapshot(): FilterDocument { return structuredClone(document); },
    save(value: unknown): Promise<FilterDocument> {
      const candidate = validate(value);
      const operation = pending.then(async () => {
        if (candidate.revision !== document.revision) {
          throw new FilterError('Filters zijn gewijzigd. Laad de opgeslagen versie voordat je opnieuw opslaat.', 409);
        }
        if (document.revision === Number.MAX_SAFE_INTEGER) throw new FilterError('De filterrevisie kan niet worden verhoogd.', 500);
        const next = { revision: document.revision + 1, settings: candidate.settings };
        if (path) {
          const temporary = `${path}.${randomUUID()}.tmp`;
          try {
            await mkdir(dirname(path), { recursive: true, mode: 0o700 });
            await writeFile(temporary, JSON.stringify(next, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
            await rename(temporary, path);
          } catch {
            await unlink(temporary).catch(() => {});
            throw new FilterError('Opslaan op de server is mislukt. De vorige filters blijven actief.', 500);
          }
        }
        document = next;
        return structuredClone(document);
      });
      pending = operation.then(() => {}, () => {});
      return operation;
    }
  };
}

export type FilterStore = ReturnType<typeof createFilterStore>;

export async function loadFilterStore(path: string): Promise<FilterStore> {
  try {
    const content = await readFile(path, 'utf8');
    if (Buffer.byteLength(content) > 32 * 1024) throw new Error('Te groot');
    return createFilterStore(path, validate(JSON.parse(content)));
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return createFilterStore(path);
    throw new Error('Kan data/filters.json niet lezen. Herstel dit bestand voordat de server wordt gestart.');
  }
}
