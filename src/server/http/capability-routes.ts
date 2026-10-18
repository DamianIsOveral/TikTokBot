import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ChatAccess } from '../chat-access.ts';
import { allowMutation } from './security.ts';

export async function routeCapabilities(req: IncomingMessage, res: ServerResponse, access: ChatAccess,
  authorized: () => boolean = () => true): Promise<boolean> {
  if (req.url !== '/api/capabilities') return false;
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'GET') {
    res.end(JSON.stringify(await access.refresh()));
  } else if (allowMutation(req, res)) {
    if (!authorized()) { req.resume(); res.writeHead(403).end(); return true; }
    res.end(JSON.stringify(await access.refresh(true)));
  }
  return true;
}
