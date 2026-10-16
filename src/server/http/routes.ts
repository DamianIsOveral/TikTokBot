import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppConfig } from '../config.ts';
import type { createLive } from '../live.ts';
import type { createSession } from '../session.ts';
import type { createEventStream } from './events.ts';
import { allowMutation } from './security.ts';

interface Services {
  config: AppConfig;
  live: ReturnType<typeof createLive>;
  session: ReturnType<typeof createSession>;
  events: ReturnType<typeof createEventStream>;
}

export function routeApi(req: IncomingMessage, res: ServerResponse, services: Services): boolean {
  const { config, live, session, events } = services;
  function json(data: unknown): void {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(data));
  }
  if (req.url === '/health' && req.method === 'GET') {
    json({ ok: true, app: 'faynominaal-live' }); return true;
  }
  if (req.url === '/api/config' && req.method === 'GET') {
    json({ username: config.username, botEnabled: config.botEnabled }); return true;
  }
  if (req.url === '/api/snapshot' && req.method === 'GET') {
    json(session.snapshot()); return true;
  }
  if (req.url === '/api/events' && req.method === 'GET') {
    events.subscribe(req, res, session.snapshot()); return true;
  }
  if (req.url === '/api/connect' || req.url === '/api/stop') {
    if (allowMutation(req, res)) {
      if (req.url === '/api/connect') void live.connect();
      else void live.stop();
      res.writeHead(202).end();
    }
    return true;
  }
  return false;
}
