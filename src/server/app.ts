import http from 'node:http';
import type { AppConfig } from './config.ts';
import type { ConnectorLoader } from './types.ts';
import { createLive } from './live.ts';
import { createSession } from './session.ts';
import { createEventStream } from './http/events.ts';
import { secureRequest } from './http/security.ts';
import { routeApi } from './http/routes.ts';
import { serveAsset } from './http/assets.ts';

export function createApp(config: AppConfig, loadConnector?: ConnectorLoader) {
  const events = createEventStream();
  const session = createSession(events.broadcast);
  const live = createLive(config, session.receive, loadConnector);
  const server = http.createServer(async (req, res) => {
    if (!secureRequest(req, res, config.port)) return;
    if (!routeApi(req, res, { config, live, session, events })) await serveAsset(req, res);
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.maxConnections = 50;
  async function close(): Promise<void> {
    events.close();
    await live.stop();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
  return { server, close };
}
