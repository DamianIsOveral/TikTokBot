import { mkdir, readFile, rename, writeFile, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CommandDefinition, CommandDocument } from '../shared/commands.ts';
import { defaultCommands } from './command-defaults.ts';
import { CommandError, validateCommands } from './command-validation.ts';
import { defaultCommandLimits } from '../shared/command-policy.ts';

export function createCommandStore(path?: string, initial: CommandDocument = { revision: 0, commands: defaultCommands() }) {
  let document = validateCommands(initial);
  let pending = Promise.resolve();
  return {
    list(): readonly CommandDefinition[] { return document.commands; },
    limits() { return {...(document.limits||defaultCommandLimits)}; },
    snapshot(): CommandDocument { return structuredClone(document); },
    save(value: unknown, authorized: () => boolean = () => true): Promise<CommandDocument> {
      const candidate = validateCommands(value);
      const authorize = () => {
        if (!authorized()) throw new CommandError('Je hebt geen toegang om commands aan te passen.', 403);
      };
      const operation = pending.then(async () => {
        authorize();
        if (candidate.revision !== document.revision) {
          throw new CommandError('Commands zijn gewijzigd in een ander tabblad. Herlaad de opgeslagen versie en probeer opnieuw.', 409);
        }
        const next = { ...candidate, ...(!candidate.limits&&document.limits?{limits:{...document.limits}}:{}), revision: document.revision + 1 };
        if (path) {
          const temporary = `${path}.${randomUUID()}.tmp`;
          try {
            await mkdir(dirname(path), { recursive: true, mode: 0o700 });
            await writeFile(temporary, JSON.stringify(next, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
            authorize();
            await rename(temporary, path);
          } catch (error) {
            await unlink(temporary).catch(() => {});
            if (error instanceof CommandError) throw error;
            throw new CommandError('Opslaan op de server is mislukt. De vorige configuratie blijft actief.', 500);
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

export type CommandStore = ReturnType<typeof createCommandStore>;

export async function loadCommandStore(path: string): Promise<CommandStore> {
  try {
    const content = await readFile(path, 'utf8');
    if (Buffer.byteLength(content) > 128 * 1024) throw new Error('Te groot');
    return createCommandStore(path, validateCommands(JSON.parse(content)));
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return createCommandStore(path);
    throw new Error('Kan data/commands.json niet lezen. Herstel dit bestand voordat de server wordt gestart.');
  }
}
