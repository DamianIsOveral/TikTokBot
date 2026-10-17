import { mkdir, open, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AuditEntry, AuditInput, AuditStore } from '../shared/moderation.ts';
export type { AuditEntry, AuditInput, AuditStore } from '../shared/moderation.ts';

const maxEntries = 1000;
const maxBytes = 1024 * 1024;
const actions = new Set(['mute', 'unmute', 'ban', 'unban']);
const statuses = new Set(['pending', 'accepted', 'rejected', 'uncertain']);
const durations = new Set([0, 5, 30, 60, 300]);
function invalid(): never { throw new Error('Ongeldig moderatielog.'); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number, pattern?: RegExp): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)
    || (pattern && !pattern.test(value))) invalid();
  return value;
}
function normalizeInput(value: unknown): AuditInput {
  const data = object(value);
  const actor = object(data.actor);
  const target = object(data.target);
  const actorId = text(actor.id, 20);
  const actorName = text(actor.name, 100);
  if (actorId === 'system') {
    if (actorName !== 'CLI-test (geen Discordsessie)') invalid();
  } else if (!/^\d{17,20}$/.test(actorId)) invalid();
  if (typeof data.action !== 'string' || !actions.has(data.action)) invalid();
  const action = data.action as AuditInput['action'];
  if (action === 'mute' ? typeof data.duration !== 'number' || !durations.has(data.duration) : data.duration !== undefined) invalid();
  return { actor: { id: actorId, name: actorName },
    target: { id: text(target.id, 25, /^\d{1,25}$/), name: text(target.name, 100) },
    roomId: text(data.roomId, 25, /^\d{10,25}$/), action,
    ...(action === 'mute' ? { duration: data.duration as number } : {}) };
}
function normalizeEntry(value: unknown): AuditEntry {
  const data = object(value);
  const input = normalizeInput(data);
  const id = text(data.id, 64, /^[\w-]{1,64}$/);
  const at = text(data.at, 32);
  const timestamp = new Date(at);
  if (!Number.isFinite(timestamp.getTime()) || timestamp.toISOString() !== at
    || typeof data.status !== 'string' || !statuses.has(data.status)) invalid();
  let reason: string | undefined;
  if (data.reason !== undefined && data.reason !== '') reason = text(data.reason, 300);
  return { id, at, ...input, status: data.status as AuditEntry['status'], ...(reason ? { reason } : {}) };
}
function encode(entries: AuditEntry[]): string { return JSON.stringify({ version: 1, entries }) + '\n'; }
function bytes(entries: AuditEntry[]): number { return Buffer.byteLength(encode(entries)); }
function bounded(entries: AuditEntry[]): AuditEntry[] {
  const result = [...entries];
  while (result.length > maxEntries || bytes(result) > maxBytes) {
    const index = result.findIndex(entry => entry.status !== 'pending');
    if (index < 0) throw new Error('Moderatielog zit vol met onafgeronde acties.');
    result.splice(index, 1);
  }
  return result;
}

export function createAuditStore(path?: string, initialEntries: AuditEntry[] = [], now: () => Date = () => new Date()): AuditStore {
  if (!Array.isArray(initialEntries) || initialEntries.length > maxEntries) invalid();
  let entries = initialEntries.map(normalizeEntry);
  if (new Set(entries.map(entry => entry.id)).size !== entries.length || bytes(entries) > maxBytes) invalid();
  let pending = Promise.resolve();
  async function persist(next: AuditEntry[]): Promise<void> {
    if (!path) return;
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await writeFile(temporary, encode(next), { flag: 'wx', mode: 0o600, flush: true });
      await rename(temporary, path);
    } catch {
      await unlink(temporary).catch(() => {});
      throw new Error('Moderatielog kon niet veilig worden opgeslagen.');
    }
  }
  function enqueue(change: () => { entries: AuditEntry[]; result: AuditEntry }): Promise<AuditEntry> {
    const operation = pending.then(async () => {
      const next = change();
      const kept = bounded(next.entries);
      if (!kept.some(entry => entry.id === next.result.id)) throw new Error('Moderatielog kan deze actie niet behouden.');
      await persist(kept);
      entries = kept;
      return structuredClone(next.result);
    });
    pending = operation.then(() => {}, () => {});
    return operation;
  }
  return {
    list(limit = 100): AuditEntry[] {
      if (!Number.isInteger(limit) || limit < 0 || limit > maxEntries) invalid();
      return limit === 0 ? [] : structuredClone(entries.slice(-limit).reverse());
    },
    async begin(input): Promise<AuditEntry> {
      const safe = normalizeInput(input);
      return enqueue(() => {
        const at = now().toISOString();
        const entry = normalizeEntry({ ...safe, id: randomUUID(), at, status: 'pending' });
        return { entries: [...entries, entry], result: entry };
      });
    },
    async finish(id, status, reason = ''): Promise<AuditEntry> {
      if (typeof id !== 'string' || !['accepted', 'rejected', 'uncertain'].includes(status)
        || typeof reason !== 'string' || reason.length > 300 || /[\u0000-\u001f\u007f]/.test(reason)) invalid();
      const safeReason = reason;
      return enqueue(() => {
        const index = entries.findIndex(entry => entry.id === id);
        if (index < 0 || entries[index]!.status !== 'pending') throw new Error('Moderatieactie ontbreekt of is al afgerond.');
        const entry = normalizeEntry({ ...entries[index]!, status, reason: safeReason });
        return { entries: entries.map((item, position) => position === index ? entry : item), result: entry };
      });
    }
  };
}

export async function loadAuditStore(path: string): Promise<AuditStore> {
  try {
    const file = await open(path, 'r');
    let document: unknown;
    try {
      const buffer = Buffer.alloc(maxBytes + 1);
      let size = 0;
      while (size < buffer.length) {
        const read = await file.read(buffer, size, buffer.length - size, null);
        if (!read.bytesRead) break;
        size += read.bytesRead;
      }
      if (size > maxBytes) invalid();
      document = JSON.parse(buffer.subarray(0, size).toString('utf8'));
    } finally { await file.close(); }
    const value = object(document);
    if (value.version !== 1 || !Array.isArray(value.entries) || Object.keys(value).some(key => !['version', 'entries'].includes(key))) invalid();
    return createAuditStore(path, value.entries);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return createAuditStore(path);
    throw new Error('Kan data/moderation-audit.json niet laden. Herstel dit bestand voordat de server wordt gestart.');
  }
}
