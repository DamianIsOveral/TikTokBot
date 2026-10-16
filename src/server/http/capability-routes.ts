import type { IncomingMessage, ServerResponse } from 'node:http';
import type { EulerAccess } from '../euler-access.ts';
import { allowMutation } from './security.ts';

export async function routeCapabilities(req: IncomingMessage, res: ServerResponse, access: EulerAccess): Promise<boolean> {
  if (req.url !== '/api/capabilities') return false;
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'GET') {
    res.end(JSON.stringify(await access.refresh()));
  } else if (allowMutation(req, res)) {
    res.end(JSON.stringify(await access.refresh(true)));
  }
  return true;
}
