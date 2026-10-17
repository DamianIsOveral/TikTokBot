import { createCommands } from './commands.ts';
import type { AppConfig } from './config.ts';
import type { Connector, ConnectorLoader, TikTokMessage } from './types.ts';
import type { LiveEvent, Phase } from '../shared/events.ts';
import { loadConnector } from './connector.ts';
import { defaultCommands } from './command-defaults.ts';
import type { CommandDefinition } from '../shared/commands.ts';
import { connectionErrorMessage, errorRecords } from './connection-errors.ts';
import type { CommandSender } from './chat-access.ts';
import { createCommandLimiter } from './command-limiter.ts';

export function createLive(config: AppConfig, broadcast: (event: LiveEvent) => void,
  load: ConnectorLoader = loadConnector, getCommands: () => readonly CommandDefinition[] = defaultCommands,
  canSend: () => boolean = () => false, send?: CommandSender,
  schedule: (callback: () => void, ms: number) => () => void = (callback, ms) => {
    const timer = setTimeout(callback, ms); timer.unref(); return () => clearTimeout(timer);
  }) {
  let connection: Connector | undefined;
  let pending = false;
  let generation = 0;
  let status = 'Niet verbonden';
  const limiter = createCommandLimiter();
  let wanted = false;
  let retries = 0;
  let cancelRetry: (() => void) | undefined;
  let cancelStable: (() => void) | undefined;
  let isConnected = false;
  const report = (text: string, phase?: Phase): void => { status = text; broadcast({ type: 'status', text, phase }); };
  async function stop() {
    wanted = false;
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
    if (!wanted || !config.autoReconnect || blocked || retries >= 5) return;
    const ms = [5000, 15_000, 30_000, 60_000, 120_000][retries++];
    report(`Niet verbonden · opnieuw proberen over ${ms / 1000}s (${retries}/5).`, 'disconnected');
    cancelRetry?.();
    cancelRetry = schedule(() => { cancelRetry = undefined; if (wanted) void connect(false); }, ms);
  }
  async function connect(manual = true) {
    if (pending || connection) return;
    if (manual) { wanted = true; retries = 0; cancelRetry?.(); cancelRetry = undefined; }
    const attempt = ++generation;
    pending = true;
    report(`Verbinding maken met @${config.username}…`, 'connecting');
    let current: Connector | undefined;
    try {
      if (config.chatTransport === 'direct' && !send) throw new Error('Directe verzendservice ontbreekt.');
      const { TikTokLiveConnection } = await load();
      if (attempt !== generation) return;
      current = new TikTokLiveConnection(config.username, config.options);
      connection = current;
      let connected = false;
      const active = () => connected && connection === current && attempt === generation;
      const command = createCommands({
        send: text => send ? send(text, current!, active) : current!.sendMessage(text), active: () => active() && canSend(),
        botUsername: config.botUsername, report: text => broadcast({ type: 'bot', text }), getCommands, limiter
      });
      current.on('chat', (data: TikTokMessage) => {
        if (!active()) return;
        broadcast({ type: 'chat', user: String(data.user?.uniqueId || data.user?.displayId || data.uniqueId || 'onbekend').slice(0, 100),
          text: String(data.content ?? data.comment ?? '').slice(0, 2000),
          userId: typeof data.user?.idStr === 'string' && /^\d{1,25}$/.test(data.user.idStr) ? data.user.idStr : undefined,
          secUid: typeof data.user?.secUid === 'string' && /^[\w.-]{1,256}$/.test(data.user.secUid) ? data.user.secUid : undefined });
        if (config.botEnabled && canSend()) void command(data);
      });
      current.on('error', (error: unknown) => {
        if (error && typeof error === 'object' && 'info' in error && error.info === 'Failed to send message.') return;
        if (connection === current) {
          connected = isConnected = false;
          connection = undefined;
          report(connectionErrorMessage(error), 'error');
          void Promise.resolve(current?.disconnect()).catch(() => {});
          retry(error);
        }
      });
      current.on('disconnected', () => {
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
      if (connection === current) connection = undefined;
      try { await current?.disconnect(); } catch {}
      if (attempt === generation) { isConnected = false; report(connectionErrorMessage(error), 'error'); retry(error); }
    } finally { pending = false; }
  }
  return { connect, stop, get status() { return status; }, get roomId() { return isConnected ? connection?.roomId : undefined; } };
}
