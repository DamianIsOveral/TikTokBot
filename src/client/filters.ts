import { defaultFilterSettings, validFilterDocument } from '../shared/filter-settings.js';
import type { FilterDocument, FilterSettings } from '../shared/filter-settings.js';

export type { Category, FilterDocument, FilterSettings } from '../shared/filter-settings.js';
export { classify, automaticCategory } from '../shared/filter-settings.js';
let current: FilterDocument | undefined;
const activeSettings: FilterSettings = { ...defaultFilterSettings };
let changed: (() => void) | undefined;
const listeners = new Set<(document: FilterDocument) => void>();

export function loadSettings(): FilterSettings {
  return activeSettings;
}

export function applyGlobalFilters(document: unknown, onChange?: () => void): boolean {
  if (!validFilterDocument(document) || (current && document.revision <= current.revision)) return false;
  current = structuredClone(document);
  Object.assign(activeSettings, document.settings);
  for (const listener of listeners) listener(structuredClone(document));
  changed?.();
  if (onChange && onChange !== changed) onChange();
  return true;
}

export async function fetchGlobalFilters(): Promise<FilterDocument> {
  const response = await fetch('/api/filters', { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error('Filters laden mislukt.');
  const document: unknown = await response.json();
  if (!validFilterDocument(document)) throw new Error('Ongeldige filterconfiguratie ontvangen.');
  applyGlobalFilters(document);
  return structuredClone(current ?? document);
}

export async function initializeGlobalFilters(onChange: () => void): Promise<void> {
  changed = onChange;
  await fetchGlobalFilters();
}

export function subscribeGlobalFilters(listener: (document: FilterDocument) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export class FilterSaveError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

export async function saveSettings(settings: FilterSettings, revision = current?.revision ?? 0): Promise<FilterDocument> {
  const response = await fetch('/api/filters', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'faynominaal' },
    signal: AbortSignal.timeout(10_000), body: JSON.stringify({ revision, settings })
  });
  const result: unknown = await response.json();
  if (!response.ok) {
    const message = result && typeof result === 'object' && 'error' in result && typeof result.error === 'string'
      ? result.error : 'Opslaan mislukt.';
    throw new FilterSaveError(message, response.status);
  }
  if (!validFilterDocument(result)) throw new Error('Opslaan is niet bevestigd.');
  applyGlobalFilters(result);
  return structuredClone(current ?? result);
}
