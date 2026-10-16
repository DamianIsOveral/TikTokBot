import { createCommands } from './commands.js';

export function createLive(config, broadcast, load = () => import('tiktok-live-connector')) {
  let connection;
  let pending;
  let generation = 0;
  let status = 'Niet verbonden';
  const report = text => { status = text; broadcast({ type: 'status', text }); };
  async function stop() {
    generation++;
    const old = connection;
    connection = undefined;
    report('Gestopt · Niet verbonden');
    try { await old?.disconnect(); } catch { /* Connector is mogelijk al afgesloten. */ }
  }
  async function connect() {
    if (pending || connection) return;
    const attempt = ++generation;
    pending = true;
    report(`Verbinding maken met @${config.username}…`);
    let current;
    try {
      const { TikTokLiveConnection } = await load();
      if (attempt !== generation) return;
      current = new TikTokLiveConnection(config.username, config.options);
      connection = current;
      let connected = false;
      const active = () => connected && connection === current && attempt === generation;
      const command = createCommands({
        send: text => current.sendMessage(text), active,
        botUsername: config.botUsername, report
      });
      current.on('chat', data => {
        if (!active()) return;
        broadcast({ type: 'chat', user: String(data.user?.uniqueId || data.user?.displayId || data.uniqueId || 'onbekend').slice(0, 100),
          text: String(data.content ?? data.comment ?? '').slice(0, 2000) });
        if (config.botEnabled) void command(data);
      });
      current.on('error', () => {
        if (connection === current) report('TikTok-verbindingsprobleem. Stop en probeer opnieuw.');
      });
      current.on('disconnected', () => {
        connected = false;
        if (connection === current) { connection = undefined; report('Verbinding verbroken.'); }
      });
      await current.connect();
      if (attempt !== generation || connection !== current) { await current.disconnect(); return; }
      connected = true;
      report(`LIVE verbonden met @${config.username} · bot ${config.botEnabled ? 'aan' : 'uit'}`);
    } catch {
      if (connection === current) connection = undefined;
      try { await current?.disconnect(); } catch {}
      if (attempt === generation) report('Verbinden mislukt. Controleer LIVE-status en serverinstellingen.');
    } finally { pending = false; }
  }
  return { connect, stop, get status() { return status; } };
}
