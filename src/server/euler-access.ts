import type { ChatCapabilities } from '../shared/capabilities.ts';

export type AccountReader = (key: string, signal: AbortSignal) => Promise<unknown>;
const CACHE_MS = 5 * 60_000;
// Euler's route-access mapping: WEBCAST_PREMIUM = AccountScopes.NUMBER_13.
const WEBCAST_PREMIUM = 13;
class InvalidKey extends Error {}

export const readEulerAccount: AccountReader = async (key, signal) => {
  const response = await fetch('https://api.eulerstream.com/accounts/me', {
    headers: { 'x-api-key': key, Accept: 'application/json' }, signal, redirect: 'error'
  });
  if (response.status === 401 || response.status === 403) throw new InvalidKey();
  if (!response.ok) throw new Error('Euler-accountcontrole mislukt.');
  return response.json();
};

export function createEulerAccess(key: string | undefined, publish: (value: ChatCapabilities) => void,
  read: AccountReader = readEulerAccount, now = Date.now) {
  let value: ChatCapabilities = { state: 'checking', chat: false, moderation: false,
    reason: 'Euler-rechten worden gecontroleerd.', checkedAt: null };
  let validUntil = 0;
  let attemptedAt = -Infinity;
  let pending: Promise<ChatCapabilities> | undefined;
  let closed = false;
  let controller: AbortController | undefined;

  function snapshot(): ChatCapabilities {
    if (value.state === 'available' && now() >= validUntil) {
      return { ...value, state: 'unknown', chat: false, moderation: false,
        reason: 'Euler-rechten moeten opnieuw worden gecontroleerd.' };
    }
    return { ...value };
  }

  function refresh(force = false): Promise<ChatCapabilities> {
    if (closed) return Promise.resolve(snapshot());
    if (pending) return pending;
    const expired = value.state === 'available' && now() >= validUntil;
    if (!expired && now() - attemptedAt < (force ? 30_000 : CACHE_MS)) return Promise.resolve(snapshot());
    attemptedAt = now();
    pending = (async () => {
      let next: ChatCapabilities;
      const checkedAt = new Date(now()).toISOString();
      try {
        if (!key) {
          next = { state: 'unavailable', chat: false, moderation: false, checkedAt,
            reason: 'Geen Euler API-sleutel ingesteld. Chatverzending en LIVE-moderatie zijn geblokkeerd.' };
        } else {
          controller = new AbortController();
          const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]);
          const data = await read(key, signal) as { account?: { scopes?: unknown; expires_at?: unknown } } | null;
          const account = data?.account;
          if (!account || !Array.isArray(account.scopes) || !account.scopes.every(Number.isInteger)) {
            throw new Error('Onbekende accountstructuur.');
          }
          const expiry = account.expires_at === null ? Infinity
            : typeof account.expires_at === 'string' ? Date.parse(account.expires_at) : NaN;
          if (Number.isNaN(expiry)) throw new Error('Onbekende vervaldatum.');
          const allowed = expiry > now() && account.scopes.includes(WEBCAST_PREMIUM);
          validUntil = Math.min(now() + CACHE_MS, expiry);
          next = { state: allowed ? 'available' : 'unavailable', chat: allowed, moderation: allowed, checkedAt,
            reason: expiry <= now() ? 'Euler-account is verlopen. Chatverzending en LIVE-moderatie zijn geblokkeerd.'
              : allowed ? 'Webcast Premium beschikbaar voor chatverzending en LIVE-moderatie.'
                : 'Geen Webcast Premium op deze API-sleutel. Community ondersteunt geen botantwoorden, mutes of bans.' };
        }
      } catch (error) {
        next = { state: 'unknown', chat: false, moderation: false, checkedAt,
          reason: error instanceof InvalidKey ? 'Euler weigert de API-sleutel. Controleer de serverinstellingen.'
            : 'Euler-rechten konden niet worden gecontroleerd. Verzenden en LIVE-moderatie blijven geblokkeerd.' };
      }
      if (!closed) { value = next; publish(snapshot()); }
      return snapshot();
    })().finally(() => { pending = undefined; });
    return pending;
  }

  return { snapshot, refresh, canSend: () => snapshot().chat,
    close: () => { closed = true; controller?.abort(); } };
}

export type EulerAccess = ReturnType<typeof createEulerAccess>;
