import { mkdir, readFile, rename, writeFile, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AccessDocument, AccessRole, AccessSettings } from '../../shared/auth.ts';
import { validDiscordId } from './config.ts';
import { CommandError } from '../command-validation.ts';

function validate(value: unknown): AccessDocument {
  if (!value || typeof value !== 'object') throw new CommandError('Ongeldige toegangslijst.');
  const data = value as Record<string, unknown>;
  if (!Number.isSafeInteger(data.revision) || Number(data.revision) < 0) throw new CommandError('Ongeldige revisie.');
  if (!Array.isArray(data.users) || data.users.length > 500) throw new CommandError('Maximaal 500 Discord-IDs toegestaan.');
  const ids = new Set<string>();
  const users = data.users.map((item: unknown) => {
    if (!item || typeof item !== 'object') throw new CommandError('Ongeldige gebruiker.');
    const row = item as Record<string, unknown>;
    if (typeof row.id !== 'string' || !validDiscordId(row.id) || ids.has(row.id)) throw new CommandError('Discord-IDs moeten uniek zijn en uit 17–20 cijfers bestaan.');
    if (row.role !== 'admin' && row.role !== 'head-moderator' && row.role !== 'member') throw new CommandError('Ongeldige gebruikersrol.');
    if (row.comment !== undefined && (typeof row.comment !== 'string' || row.comment.length > 120 || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(row.comment))) {
      throw new CommandError('Opmerkingen mogen maximaal 120 tekens bevatten, zonder besturings- of onzichtbare tekens.');
    }
    ids.add(row.id);
    const comment = typeof row.comment === 'string' ? row.comment.trim() : '';
    return { id: row.id, role: row.role as AccessRole, ...(comment ? { comment } : {}) };
  });
  return { revision: Number(data.revision), users };
}

export function createAccessStore(protectedIds: string[], path?: string, initial: unknown = { revision: 0, users: [] }) {
  if (protectedIds.some(id => !validDiscordId(id))) throw new Error('Ongeldige beheerder-ID.');
  let document = validate(initial);
  for (const id of protectedIds) {
    const comment = document.users.find(user => user.id === id)?.comment;
    document.users = document.users.filter(user => user.id !== id);
    document.users.push({ id, role: 'admin', ...(comment ? { comment } : {}) });
  }
  let pending = Promise.resolve();
  return {
    role(id: string): AccessRole | undefined { return document.users.find(user => user.id === id)?.role; },
    snapshot(): AccessSettings { return { ...structuredClone(document), protectedIds: [...protectedIds] }; },
    save(value: unknown): Promise<AccessSettings> {
      const candidate = validate(value);
      if (protectedIds.some(id => !candidate.users.some(user => user.id === id && user.role === 'admin'))) {
        throw new CommandError('Vaste beheerders kunnen niet verwijderd of gedegradeerd worden.');
      }
      if (!candidate.users.some(user => user.role === 'admin')) throw new CommandError('Behoud minimaal één beheerder.');
      const operation = pending.then(async () => {
        if (candidate.revision !== document.revision) throw new CommandError('De toegangslijst is gewijzigd. Herlaad de opgeslagen versie.', 409);
        const next = { ...candidate, revision: document.revision + 1 };
        if (path) {
          const temporary = `${path}.${randomUUID()}.tmp`;
          try {
            await mkdir(dirname(path), { recursive: true, mode: 0o700 });
            await writeFile(temporary, JSON.stringify(next, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
            await rename(temporary, path);
          } catch {
            await unlink(temporary).catch(() => {});
            throw new CommandError('Toegangslijst kon niet worden opgeslagen. De vorige lijst blijft actief.', 500);
          }
        }
        document = next;
        return { ...structuredClone(document), protectedIds: [...protectedIds] };
      });
      pending = operation.then(() => {}, () => {});
      return operation;
    }
  };
}

export type AccessStore = ReturnType<typeof createAccessStore>;

export async function loadAccessStore(path: string, protectedIds: string[]): Promise<AccessStore> {
  try {
    const content = await readFile(path, 'utf8');
    if (Buffer.byteLength(content) > 128 * 1024) throw new Error();
    return createAccessStore(protectedIds, path, JSON.parse(content));
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return createAccessStore(protectedIds, path);
    throw new Error('Kan data/access.json niet laden. Herstel de toegangslijst voordat de server wordt gestart.');
  }
}
