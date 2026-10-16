import type { ConnectorOptions } from './types.ts';

export interface AppConfig {
  host: string;
  port: number;
  username: string;
  botEnabled: boolean;
  botUsername: string;
  options: ConnectorOptions;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const host = env.HOST || '127.0.0.1';
  if (!['127.0.0.1', '::1', 'localhost'].includes(host)) {
    throw new Error('HOST moet lokaal blijven totdat authenticatie is geïmplementeerd.');
  }
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Ongeldige PORT.');
  const username = env.TIKTOK_USERNAME || 'faynominaal';
  if (!/^[\w.]{1,24}$/.test(username)) throw new Error('Ongeldige TIKTOK_USERNAME.');
  const credentials = [env.EULER_API_KEY, env.TIKTOK_SESSION_ID, env.TIKTOK_TARGET_IDC];
  if (credentials.some(Boolean) && !credentials.every(Boolean)) {
    throw new Error('Vul alle drie TikTok/Euler-instellingen in of laat ze alle drie leeg.');
  }
  const botEnabled = env.BOT_ENABLED === 'true';
  if (botEnabled && !credentials.every(Boolean)) throw new Error('Bot vereist TikTok/Euler-instellingen.');
  return { host, port, username, botEnabled, botUsername: env.BOT_USERNAME || 'faynominaalbot',
    options: credentials.every(Boolean) ? {
      processInitialData: false, signApiKey: credentials[0], authenticateWs: true,
      session: { cookie: { type: 'cookie', value: { sessionId: credentials[1]!, ttTargetIdc: credentials[2]! } } }
    } : { processInitialData: false } };
}
