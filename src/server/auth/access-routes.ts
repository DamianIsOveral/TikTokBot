import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DashboardUser } from '../../shared/auth.ts';
import type { AccessStore } from './access-store.ts';
import { allowMutation } from '../http/security.ts';
import { readJson } from '../http/json.ts';
import { CommandError } from '../command-validation.ts';

export async function routeAccess(req: IncomingMessage, res: ServerResponse, store: AccessStore,
  user: DashboardUser, onChange: () => void): Promise<boolean> {
  if (req.url !== '/api/access') return false;
  res.setHeader('Content-Type', 'application/json');
  if (user.role !== 'admin') { res.writeHead(403).end('{"error":"Alleen beheerders mogen toegang beheren."}'); return true; }
  if (req.method === 'GET') res.end(JSON.stringify(store.snapshot()));
  else if (allowMutation(req, res)) {
    try {
      const next = await store.save(await readJson(req));
      onChange();
      res.end(JSON.stringify(next));
    } catch (error) {
      res.writeHead(error instanceof CommandError ? error.status : 500).end(JSON.stringify({
        error: error instanceof CommandError ? error.message : 'Toegang wijzigen mislukt.'
      }));
    }
  }
  return true;
}
