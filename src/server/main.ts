import { readConfig } from './config.ts';
import { createApp } from './app.ts';
import { loadCommandStore } from './command-store.ts';
import { fileURLToPath } from 'node:url';

const config = readConfig();
const commands = await loadCommandStore(fileURLToPath(new URL('../../data/commands.json', import.meta.url)));
const app = createApp(config, undefined, commands);
app.server.listen(config.port, config.host, () => {
  console.log(`Dashboard: http://${config.host === '::1' ? '[::1]' : config.host}:${config.port}`);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  const deadline = setTimeout(() => process.exit(1), 5000);
  deadline.unref();
  void app.close().then(() => clearTimeout(deadline));
});
