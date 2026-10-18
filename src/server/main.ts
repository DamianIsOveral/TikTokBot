import { readConfig } from './config.ts';
import { createApp } from './app.ts';
import { loadCommandStore } from './command-store.ts';
import { fileURLToPath } from 'node:url';
import { loadAccessStore } from './auth/access-store.ts';
import { loadAuditStore } from './moderation-audit.ts';
import {loadSessionState} from './tiktok/session-state.ts';

const config = readConfig();
const commands = await loadCommandStore(fileURLToPath(new URL('../../data/commands.json', import.meta.url)));
const access = await loadAccessStore(fileURLToPath(new URL('../../data/access.json', import.meta.url)), config.discord.adminIds);
const audit = await loadAuditStore(fileURLToPath(new URL('../../data/moderation-audit.json', import.meta.url)));
const sessionState=config.directCredentials?await loadSessionState(fileURLToPath(new URL('../../data/tiktok-session.json',import.meta.url)),config.directCredentials):undefined;
const app = createApp(config, undefined, commands, access, undefined, undefined, sessionState?{sessionState}:undefined, audit);
app.server.listen(config.port, config.host, () => {
  console.log(`Dashboard: http://${config.host === '::1' ? '[::1]' : config.host}:${config.port}`);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  const deadline = setTimeout(() => process.exit(1), 5000);
  deadline.unref();
  void app.close().then(() => clearTimeout(deadline));
});
