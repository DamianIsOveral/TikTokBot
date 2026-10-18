import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FilterDocument } from '../../shared/filter-settings.ts';
import { FilterError } from '../filter-store.ts';
import type { FilterStore } from '../filter-store.ts';
import { CommandError } from '../command-validation.ts';
import { allowMutation } from './security.ts';
import { readJson } from './json.ts';

export async function routeFilters(req: IncomingMessage, res: ServerResponse, store: FilterStore,
  changed: (document: FilterDocument) => void = () => {}, authorized: () => boolean = () => true): Promise<boolean> {
  if (req.url !== '/api/filters') return false;
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'POST' && !authorized()) {
    req.resume();
    res.writeHead(403).end(JSON.stringify({ error: 'Alleen hoofd-moderators en beheerders mogen filters aanpassen.' }));
    return true;
  }
  if (req.method === 'GET') {
    res.end(JSON.stringify(store.snapshot()));
  } else if (allowMutation(req, res)) {
    try {
      const saved = await store.save(await readJson(req), authorized);
      changed(saved);
      res.end(JSON.stringify(saved));
    } catch (error) {
      const known = error instanceof FilterError || error instanceof CommandError;
      const status = known ? error.status : 500;
      res.writeHead(status).end(JSON.stringify({ error: known ? error.message : 'Opslaan mislukt.',
        ...(status === 409 ? { currentRevision: store.snapshot().revision } : {}) }));
    }
  }
  return true;
}
