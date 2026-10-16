import type { DiscordConfig } from './config.ts';
import { validDiscordId } from './config.ts';

export interface DiscordIdentity { id: string; name: string }
export interface DiscordProvider { identify(code: string): Promise<DiscordIdentity> }

export function createDiscordProvider(config: DiscordConfig, request: typeof fetch = fetch): DiscordProvider {
  return {
    async identify(code: string): Promise<DiscordIdentity> {
      const tokenResponse = await request('https://discord.com/api/oauth2/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret,
          grant_type: 'authorization_code', code, redirect_uri: config.redirectUri }),
        signal: AbortSignal.timeout(10_000), redirect: 'error'
      });
      if (!tokenResponse.ok) throw new Error('Discord-tokenuitwisseling mislukt.');
      const token: unknown = await tokenResponse.json();
      if (!token || typeof token !== 'object' || !('access_token' in token)
        || typeof token.access_token !== 'string' || token.access_token.length > 8192) throw new Error('Ongeldig Discord-token.');
      const response = await request('https://discord.com/api/v10/users/@me', {
        headers: { Authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(10_000), redirect: 'error'
      });
      if (!response.ok) throw new Error('Discord-identiteit ophalen mislukt.');
      const user: unknown = await response.json();
      if (!user || typeof user !== 'object' || !('id' in user) || typeof user.id !== 'string' || !validDiscordId(user.id)) {
        throw new Error('Ongeldig Discord-ID.');
      }
      const name = 'global_name' in user && typeof user.global_name === 'string' ? user.global_name
        : 'username' in user && typeof user.username === 'string' ? user.username : user.id;
      return { id: user.id, name: name.slice(0, 80) };
    }
  };
}
