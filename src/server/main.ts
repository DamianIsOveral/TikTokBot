import { readConfig } from './config.ts';
import { createApp } from './app.ts';

const config = readConfig();
const app = createApp(config);
app.server.listen(config.port, config.host, () => {
  console.log(`Dashboard: http://${config.host === '::1' ? '[::1]' : config.host}:${config.port}`);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  const deadline = setTimeout(() => process.exit(1), 5000);
  deadline.unref();
  void app.close().then(() => clearTimeout(deadline));
});
