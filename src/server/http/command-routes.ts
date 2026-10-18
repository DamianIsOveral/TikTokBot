import type { IncomingMessage, ServerResponse } from 'node:http';
import type { CommandStore } from '../command-store.ts';
import { CommandError } from '../command-validation.ts';
import { allowMutation } from './security.ts';
import { readJson } from './json.ts';
import type { ChatAccess } from '../chat-access.ts';

export async function routeCommands(req: IncomingMessage, res: ServerResponse, store: CommandStore, botEnabled: boolean,
  access: ChatAccess, changed: (revision: number) => void = () => {}): Promise<boolean> {
  if (req.url !== '/api/commands') return false;
  res.setHeader('Content-Type', 'application/json');
  const capabilities = await access.refresh();
  if (req.method === 'GET') {
    res.end(JSON.stringify({ ...store.snapshot(), botEnabled, capabilities }));
  } else if (allowMutation(req, res)) {
    if (!access.canSend()) {
      res.writeHead(403).end(JSON.stringify({ error: capabilities.reason, capabilities })); return true;
    }
    try {
      const saved = await store.save(await readJson(req));
      changed(saved.revision);
      res.end(JSON.stringify({ ...saved, botEnabled, capabilities }));
    } catch (error) {
      const status = error instanceof CommandError ? error.status : 500;
      res.writeHead(status).end(JSON.stringify({ error: error instanceof CommandError ? error.message : 'Opslaan mislukt.',
        ...(status === 409 ? { currentRevision:store.snapshot().revision } : {}) }));
    }
  }
  return true;
}
