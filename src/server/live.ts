import { createCommands } from './commands.ts';
import type {CommandMetrics} from './commands.ts';
import type { AppConfig } from './config.ts';
import type { Connector, ConnectorLoader, TikTokMessage } from './types.ts';
import type { LiveEvent, Phase } from '../shared/events.ts';
import { loadConnector } from './connector.ts';
import { defaultCommands } from './command-defaults.ts';
import type { CommandDefinition, CommandLimits } from '../shared/commands.ts';
import { defaultCommandLimits } from '../shared/command-policy.ts';
import { connectionErrorMessage, errorRecords } from './connection-errors.ts';
import type { CommandSender } from './chat-access.ts';
import { createCommandLimiter } from './command-limiter.ts';
import { incomingChat } from './incoming-chat.ts';
import { createLiveActivity } from './live-activity.ts';

export function createLive(config: AppConfig, broadcast: (event: LiveEvent) => void,
  load: ConnectorLoader = loadConnector, getCommands: () => readonly CommandDefinition[] = defaultCommands,
  canSend: () => boolean = () => false, send?: CommandSender,
  schedule: (callback: () => void, ms: number) => () => void = (callback, ms) => {
    const timer = setTimeout(callback, ms); timer.unref(); return () => clearTimeout(timer);
  }, getLimits: () => CommandLimits = () => defaultCommandLimits, getBotUserId:()=>string|undefined=()=>undefined) {
  let connection: Connector | undefined;
  let pending = false;
  let generation = 0;
  let status = 'Niet verbonden';
  const limiter = createCommandLimiter(Date.now,getLimits);
  let activeCommands: AbortController | undefined;
  let wanted = false;
  let retries = 0;
  let cancelRetry: (() => void) | undefined;
  let cancelStable: (() => void) | undefined;
  let isConnected = false;
  let retryRequested = false;
  let retryBlocked = false;
  let reconnects=0;
  let lastEventAt:string|null=null;
  const commandMetrics:CommandMetrics={matched:0,sent:0,attempted:0,rateLimited:0,roleDenied:0,invalid:0,failed:0};
  const report = (text: string, phase?: Phase): void => { status = text; broadcast({ type: 'status', text, phase }); };
  async function stop() {
    activeCommands?.abort();
    wanted = false;
    retryRequested = false;
    isConnected = false;
    cancelRetry?.(); cancelStable?.();
    cancelRetry = cancelStable = undefined;
    generation++;
    const old = connection;
    connection = undefined;
    report('Gestopt · Niet verbonden', 'stopped');
    try { await old?.disconnect(); } catch { /* Connector is mogelijk al afgesloten. */ }
  }
  function retry(error?: unknown) {
    cancelStable?.(); cancelStable = undefined;
    const records = errorRecords(error);
    const blocked = records.some(record => /WHITELIST|session|cookie|captcha|verify|unauthorized|forbidden/i.test(String(record.message || ''))
      || /PremiumFeature|SignAPIError|SignatureRateLimit/.test(String(record.name || record.constructor?.name || ''))
      || [401, 403, 429].includes(Number(record.status)));
    if (blocked) retryBlocked = true;
    if (!wanted || !config.autoReconnect || retryBlocked || retries >= 5) return;
    if (pending) { retryRequested = true; return; }
    const ms = [5000, 15_000, 30_000, 60_000, 120_000][retries++];
    report(`Niet verbonden · opnieuw proberen over ${ms / 1000}s (${retries}/5).`, 'disconnected');
    cancelRetry?.();
    cancelRetry = schedule(() => { cancelRetry = undefined; if (wanted) {reconnects++;void connect(false);} }, ms);
  }
  async function connect(manual = true) {
    if (pending || connection) return;
    if (manual) { wanted = true; retries = 0; cancelRetry?.(); cancelRetry = undefined; }
    const attempt = ++generation;
    retryRequested = retryBlocked = false;
    pending = true;
    report(`Verbinding maken met @${config.username}…`, 'connecting');
    let current: Connector | undefined;
    const commandAbort=new AbortController();
    activeCommands=commandAbort;
    try {
      if (config.chatTransport === 'direct' && !send) throw new Error('Directe verzendservice ontbreekt.');
      const { TikTokLiveConnection } = await load();
      if (attempt !== generation) return;
      current = new TikTokLiveConnection(config.username, config.options);
      connection = current;
      let connected = false;
      const active = () => connected && connection === current && attempt === generation;
      current.on('roomUser', data => {
        if (!active() || !data || typeof data !== 'object' || !('total' in data)) return;
        const total = data.total;
        if (typeof total !== 'string' || !/^\d{1,10}$/.test(total)) return;
        const count = Number(total);
        if (count > 1_000_000_000) return;
        lastEventAt = new Date().toISOString();
        broadcast({ type: 'viewers', count });
      });
      const activity = createLiveActivity();
      for (const source of ['member', 'gift', 'follow', 'share'] as const) {
        current.on(source, data => {
          if (!active()) return;
          const event = activity(source, data);
          if (event) { lastEventAt = new Date().toISOString(); broadcast(event); }
        });
      }
      const command = createCommands({
        send: text => send ? send(text, current!, active) : current!.sendMessage(text), active: () => active() && canSend(),
        botUsername: config.botUsername, channel:config.username, report: text => broadcast({ type: 'bot', text }),
        getCommands, getLimits, limiter, signal:commandAbort.signal,metrics:commandMetrics
      });
      current.on('chat', (data: TikTokMessage) => {
        if (!active()) return;
        lastEventAt=new Date().toISOString();
        const message=incomingChat(data,config.botUsername,getBotUserId());
        broadcast(message);
        if (!message.isBot && config.botEnabled && canSend()) void command(data);
      });
      current.on('error', (error: unknown) => {
        if (error && typeof error === 'object' && 'info' in error && error.info === 'Failed to send message.') return;
        if (connection === current) {
          commandAbort.abort();
          connected = isConnected = false;
          connection = undefined;
          report(connectionErrorMessage(error), 'error');
          void Promise.resolve(current?.disconnect()).catch(() => {});
          retry(error);
        }
      });
      current.on('disconnected', () => {
        commandAbort.abort();
        connected = false;
        if (connection === current) { isConnected = false; connection = undefined; report('Verbinding verbroken.', 'disconnected'); retry(); }
      });
      await current.connect();
      if (attempt !== generation || connection !== current) { await current.disconnect(); return; }
      connected = true;
      isConnected = true;
      cancelStable?.();
      cancelStable = schedule(() => { retries = 0; cancelStable = undefined; }, 60_000);
      report(`LIVE verbonden met @${config.username}`, 'connected');
    } catch (error) {
      commandAbort.abort();
      if (connection === current) connection = undefined;
      try { await current?.disconnect(); } catch {}
      if (attempt === generation) { isConnected = false; report(connectionErrorMessage(error), 'error'); retry(error); }
    } finally {
      pending = false;
      if (retryRequested && attempt === generation) { retryRequested = false; retry(); }
    }
  }
  return { connect, stop, commandStatus: () => limiter.snapshot(),
    diagnostics:()=>({connected:isConnected,reconnects,lastEventAt,commands:{...commandMetrics}}),
    get status() { return status; }, get roomId() { return isConnected ? connection?.roomId : undefined; } };
}
