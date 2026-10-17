import type { ChatCapabilities } from '../../shared/capabilities.ts';
import type { DirectCredentials } from './direct-client.ts';
import { createDirectClient, DirectTikTokError, directErrorText } from './direct-client.ts';
import { createHeadlessSigner } from './headless-signer.ts';
import type { DirectRequestSigner } from './signing-profile.ts';

export interface DirectChatOptions {
  request?: typeof fetch;
  createSigner?: () => Promise<DirectRequestSigner>;
  now?: () => number;
}

export function createDirectChat(credentials: DirectCredentials, username: string,
  publish: (value: ChatCapabilities) => void, options: DirectChatOptions = {}) {
  const now = options.now || Date.now;
  const controller = new AbortController();
  const request: typeof fetch = (input, init) => (options.request || fetch)(input, {
    ...init, signal: AbortSignal.any([controller.signal, ...(init?.signal ? [init.signal] : [])])
  });
  let client: ReturnType<typeof createDirectClient> | undefined;
  let signer: DirectRequestSigner | undefined;
  let pending: Promise<ChatCapabilities> | undefined;
  let validUntil = 0;
  let attemptedAt = -Infinity;
  let closed = false;
  let sendFailed = false;
  let revision = 0;
  let value: ChatCapabilities = { state: 'checking', chat: false, moderation: false,
    reason: 'Rechtstreekse botsessie wordt gecontroleerd.', checkedAt: null };

  function snapshot(): ChatCapabilities {
    return closed || (value.chat && now() >= validUntil)
      ? { ...value, state: 'unknown', chat: false, moderation: false, reason: 'De botsessie moet opnieuw worden gecontroleerd.' }
      : { ...value };
  }

  function update(next: ChatCapabilities): ChatCapabilities {
    if (!closed) { value = next; publish(snapshot()); }
    return snapshot();
  }

  function refresh(force = false): Promise<ChatCapabilities> {
    if (closed) return Promise.resolve(snapshot());
    if (pending) return pending;
    if ((sendFailed && !force) || now() - attemptedAt < (force ? 30_000 : 300_000)) return Promise.resolve(snapshot());
    attemptedAt = now();
    const attempt = revision;
    pending = (async () => {
      const checkedAt = new Date(now()).toISOString();
      try {
        signer ||= await (options.createSigner || createHeadlessSigner)();
        const next = client ?? createDirectClient(credentials, request, { signRequest: signer });
        await next.verifyIdentity();
        if (closed || attempt !== revision) return snapshot();
        client = next;
        sendFailed = false;
        validUntil = now() + 300_000;
        return update({ state: 'available', chat: true, moderation: false, checkedAt,
          reason: 'Rechtstreekse TikTok-chat actief; botsessie gecontroleerd. LIVE-moderatie is nog niet aangesloten.' });
      } catch (error) {
        if (closed || attempt !== revision) return snapshot();
        client = undefined;
        validUntil = 0;
        return update({ state: 'unknown', chat: false, moderation: false, checkedAt,
          reason: error instanceof DirectTikTokError ? directErrorText(error) : 'De rechtstreekse ondertekenaar is niet beschikbaar. Controleer de serverinstellingen.' });
      }
    })().finally(() => { pending = undefined; });
    return pending;
  }

  const canSend = () => snapshot().chat;
  async function send(text: string, roomId: string | undefined, active: () => boolean): Promise<unknown> {
    if (!client || !canSend() || !active()) throw new DirectTikTokError('inactive');
    if (!roomId || !/^\d{10,25}$/.test(roomId)) throw new DirectTikTokError('response');
    try {
      return await client.sendMessage(roomId, username, text, () => canSend() && active());
    } catch (error) {
      if (!(error instanceof DirectTikTokError && error.kind === 'inactive')) {
        revision++;
        client = undefined;
        sendFailed = true;
        validUntil = 0;
        update({ state: 'unknown', chat: false, moderation: false, checkedAt: value.checkedAt,
          reason: `${directErrorText(error)} Verzending is gepauzeerd; controleer de sessie en klik op Rechten opnieuw controleren.` });
      }
      throw error;
    }
  }
  return { snapshot, refresh, canSend, send, close: () => { closed = true; revision++; client = undefined; controller.abort(); } };
}
