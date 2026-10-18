import http from 'node:http';
import type { AppConfig } from './config.ts';
import type { ConnectorLoader } from './types.ts';
import { createLive } from './live.ts';
import { createSession } from './session.ts';
import { createEventStream } from './http/events.ts';
import { secureRequest } from './http/security.ts';
import { routeApi } from './http/routes.ts';
import { serveAsset } from './http/assets.ts';
import { createCommandStore } from './command-store.ts';
import { routeCommands } from './http/command-routes.ts';
import { createAccessStore } from './auth/access-store.ts';
import { createAuth } from './auth/service.ts';
import { routeAccess } from './auth/access-routes.ts';
import type { DiscordProvider } from './auth/discord.ts';
import { createEulerAccess } from './euler-access.ts';
import type { AccountReader } from './euler-access.ts';
import { routeCapabilities } from './http/capability-routes.ts';
import { createDirectChat } from './tiktok/direct-chat.ts';
import type { DirectChatOptions } from './tiktok/direct-chat.ts';
import type { ChatAccess } from './chat-access.ts';
import { createAuditStore } from './moderation-audit.ts';
import type { AuditStore } from '../shared/moderation.ts';
import { createModerationRoutes } from './http/moderation-routes.ts';
import {routeDiagnostics} from './http/diagnostic-routes.ts';
import {createCredentialRoutes} from './http/credential-routes.ts';

export function createApp(config: AppConfig, loadConnector?: ConnectorLoader, commands = createCommandStore(),
  access = createAccessStore(config.discord.adminIds), provider?: DiscordProvider, accountReader?: AccountReader,
  directOptions?: DirectChatOptions, audit: AuditStore = createAuditStore()) {
  const events = createEventStream();
  const session = createSession(events.broadcast);
  if (config.chatTransport === 'direct' && !config.directCredentials) throw new Error('Directe chatconfiguratie ontbreekt.');
  const publish = (value: ReturnType<ChatAccess['snapshot']>) => session.receive({ type: 'capabilities', value });
  const direct = config.chatTransport === 'direct' && config.directCredentials
    ? createDirectChat(config.directCredentials, config.username, publish, directOptions) : undefined;
  const capabilities: ChatAccess = direct ?? createEulerAccess(config.options.signApiKey, publish, accountReader);
  const live = createLive(config, event => {
    if (event.type === 'status' && event.phase !== 'connected') direct?.setModerationAvailable(false);
    session.receive(event);
  }, loadConnector, () => commands.list(), capabilities.canSend,
    direct ? (text, connection, active) => direct.send(text, connection.roomId, active) : undefined,
    undefined,()=>commands.limits(),()=>direct?.botUserId());
  void capabilities.refresh();
  if (config.autoConnect) void live.connect();
  const rightsTimer = setInterval(() => { void capabilities.refresh(); }, 60_000);
  rightsTimer.unref();
  const auth = createAuth(config.discord, access, events.revalidate, provider);
  const routeModeration = createModerationRoutes(config, direct, live, session, audit);
  const routeCredentials=createCredentialRoutes(config,direct,live);
  const server = http.createServer(async (req, res) => {
    if (!secureRequest(req, res, config.port)) return;
    if (req.url === '/health' && req.method === 'GET') {
      res.setHeader('Content-Type', 'application/json');
      res.end('{"ok":true,"app":"faynominaal-live"}'); return;
    }
    if (await auth.route(req, res)) return;
    if (['/', '/login'].includes(req.url?.split('?')[0] || '') && req.headers.host !== new URL(config.discord.redirectUri).host) {
      res.writeHead(302, { Location: `${new URL(config.discord.redirectUri).origin}/login` }).end(); return;
    }
    const user = auth.user(req);
    if (!user) {
      if (req.url === '/') { res.writeHead(302, { Location: '/login' }).end(); return; }
      if (req.url?.startsWith('/api/')) {
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(401).end('{"error":"Log eerst in met Discord."}'); return;
      }
      await serveAsset(req, res); return;
    }
    if (req.url?.split('?')[0] === '/login') { res.writeHead(302, { Location: '/' }).end(); return; }
    if (await routeAccess(req, res, access, user, () => { auth.revalidate(); events.disconnect(); })) return;
    if (await routeModeration(req, res, user, () => !!auth.user(req))) return;
    if(await routeCredentials(req,res,user,()=>auth.user(req)?.role==='admin'))return;
    if (await routeCapabilities(req, res, capabilities)) return;
    if(routeDiagnostics(req,res,live,capabilities,config.botEnabled,direct))return;
    if (await routeCommands(req, res, commands, config.botEnabled, capabilities,
      revision => events.broadcast({type:'commands-changed',revision}))) return;
    if (!routeApi(req, res, { config, live, session, events, authorizeEvents: () => !!auth.user(req) })) await serveAsset(req, res);
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.maxConnections = 50;
  async function close(): Promise<void> {
    clearInterval(rightsTimer);
    capabilities.close();
    events.close();
    await live.stop();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
  return { server, close };
}
