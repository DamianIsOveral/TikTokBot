export interface DiscordConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  adminIds: string[];
}

export const validDiscordId = (value: string): boolean => /^[0-9]{17,20}$/.test(value);

export function readDiscordConfig(env: NodeJS.ProcessEnv, host: string, port: number, publicOrigin?: string): DiscordConfig {
  const clientId = env.DISCORD_CLIENT_ID?.trim() || '';
  const clientSecret = env.DISCORD_CLIENT_SECRET?.trim() || '';
  if (clientId && !validDiscordId(clientId)) throw new Error('Ongeldige DISCORD_CLIENT_ID.');
  const adminIds = [...new Set((env.DISCORD_ADMIN_IDS || '').split(',').map(id => id.trim()).filter(Boolean))];
  if (adminIds.some(id => !validDiscordId(id))) throw new Error('Ongeldige DISCORD_ADMIN_IDS.');
  const redirectUri = env.DISCORD_REDIRECT_URI?.trim() || `${publicOrigin || `http://${host === '::1' ? '[::1]' : host}:${port}`}/auth/discord/callback`;
  const redirect = new URL(redirectUri);
  const validOrigin = publicOrigin ? redirect.origin === publicOrigin
    : redirect.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(redirect.hostname)
      && Number(redirect.port || '80') === port;
  if (!validOrigin || redirect.pathname !== '/auth/discord/callback'
    || redirect.search || redirect.hash || redirect.username || redirect.password) {
    throw new Error('DISCORD_REDIRECT_URI moet /auth/discord/callback op de ingestelde origin gebruiken.');
  }
  return { clientId, clientSecret, redirectUri, adminIds };
}
