import type { ConnectorOptions } from './types.ts';
import { readDiscordConfig } from './auth/config.ts';
import type { DiscordConfig } from './auth/config.ts';
import type { DirectCredentials } from './tiktok/direct-client.ts';

export interface AppConfig {
  host: string;
  port: number;
  username: string;
  botEnabled: boolean;
  botUsername: string;
  chatTransport: 'euler' | 'direct';
  directCredentials?: DirectCredentials;
  options: ConnectorOptions;
  discord: DiscordConfig;
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
  const botUsername = env.BOT_USERNAME || 'faynominaalbot';
  if (!/^[\w.]{1,24}$/.test(botUsername)) throw new Error('Ongeldige BOT_USERNAME.');
  const chatTransport = env.TIKTOK_CHAT_TRANSPORT || 'euler';
  if (chatTransport !== 'euler' && chatTransport !== 'direct') throw new Error('TIKTOK_CHAT_TRANSPORT moet euler of direct zijn.');
  if (chatTransport === 'direct' && (!credentials.every(Boolean) || !env.TIKTOK_MS_TOKEN || !env.TIKTOK_VERIFY_FP)) {
    throw new Error('Directe chat vereist de TikTok/Euler-instellingen en botcookies TIKTOK_MS_TOKEN/TIKTOK_VERIFY_FP.');
  }
  return { host, port, username, botEnabled, botUsername, chatTransport,
    directCredentials: chatTransport === 'direct' ? { sessionId: credentials[1]!, targetIdc: credentials[2]!, botUsername,
      msToken: env.TIKTOK_MS_TOKEN, verifyFp: env.TIKTOK_VERIFY_FP } : undefined,
    discord: readDiscordConfig(env, host, port),
    options: credentials.every(Boolean) ? {
      processInitialData: false, signApiKey: credentials[0], authenticateWs: true,
      session: { cookie: { type: 'cookie', value: { sessionId: credentials[1]!, ttTargetIdc: credentials[2]! } } }
    } : { processInitialData: false } };
}
