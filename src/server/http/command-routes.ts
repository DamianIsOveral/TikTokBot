import type { IncomingMessage, ServerResponse } from 'node:http';
import type { CommandStore } from '../command-store.ts';
import { CommandError } from '../command-validation.ts';
import { allowMutation } from './security.ts';
import { readJson } from './json.ts';

export async function routeCommands(req: IncomingMessage, res: ServerResponse, store: CommandStore, botEnabled: boolean): Promise<boolean> {
  if (req.url !== '/api/commands') return false;
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'GET') {
    res.end(JSON.stringify({ ...store.snapshot(), botEnabled }));
  } else if (allowMutation(req, res)) {
    try {
      const saved = await store.save(await readJson(req));
      res.end(JSON.stringify({ ...saved, botEnabled }));
    } catch (error) {
      const status = error instanceof CommandError ? error.status : 500;
      res.writeHead(status).end(JSON.stringify({ error: error instanceof CommandError ? error.message : 'Opslaan mislukt.' }));
    }
  }
  return true;
}
