import type { ChatCapabilities } from '../../shared/capabilities.ts';
import type { DirectCredentials } from './direct-client.ts';
import { createDirectClient, DirectTikTokError, directErrorText } from './direct-client.ts';
import { createHeadlessSigner } from './headless-signer.ts';
import type { DirectRequestSigner } from './signing-profile.ts';
import { createOperationQueue } from '../operation-queue.ts';
import {createBotCookies} from './session-cookies.ts';
import type {SessionState} from './session-state.ts';
import {sessionFailure,needsManualSessionCheck} from './session-health.ts';

export interface DirectChatOptions {
  request?: typeof fetch;
  createSigner?: () => Promise<DirectRequestSigner>;
  now?: () => number;
  sessionState?:SessionState;
}

export function createDirectChat(credentials: DirectCredentials, username: string,
  publish: (value: ChatCapabilities) => void, options: DirectChatOptions = {}) {
  const now = options.now || Date.now;
  const jar=options.sessionState?.jar||createBotCookies(credentials,now);
  let sessionState:NonNullable<ChatCapabilities['session']>['state']='checking';
  const signerStats={initializations:0,requests:0,failures:0};
  const timings:number[]=[];
  const run = createOperationQueue();
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
    const current=closed || (value.chat && now() >= validUntil)
      ? { ...value, state: 'unknown', chat: false, moderation: false, reason: 'De botsessie moet opnieuw worden gecontroleerd.' }
      : { ...value };
    const updated=options.sessionState?.updatedAt();
    return {...current,state:current.state as ChatCapabilities['state'],session:{state:closed?'stopped':value.chat&&now()>=validUntil?'stale':sessionState,
      persistent:Boolean(options.sessionState),cookieUpdatedAt:updated===undefined?null:new Date(updated).toISOString()}};
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
        if(!signer){
          const sign=await (options.createSigner || createHeadlessSigner)();signerStats.initializations++;
          signer=async input=>{
            signerStats.requests++;
            try{const result=await sign(input);if(Number.isFinite(result.signMs)&&result.signMs>=0){timings.push(result.signMs);if(timings.length>100)timings.shift();}return result;}
            catch(error){signerStats.failures++;throw error;}
          };
        }
        const next = client ?? createDirectClient(credentials, request, { signRequest: signer,cookieJar:jar,flushCookies:options.sessionState?.flush });
        await next.verifyIdentity();
        if (closed || attempt !== revision) return snapshot();
        client = next;
        sendFailed = false;
        validUntil = now() + 300_000;
        sessionState='healthy';
        return update({ state: 'available', chat: true, moderation: value.moderation, checkedAt,
          reason: 'Rechtstreekse TikTok-chat actief; botsessie gecontroleerd. Moderatierechten worden per LIVE gecontroleerd.' });
      } catch (error) {
        if (closed || attempt !== revision) return snapshot();
        client = undefined;
        validUntil = 0;
        sessionState=sessionFailure(error);
        if(needsManualSessionCheck(error))sendFailed=true;
        return update({ state: 'unknown', chat: false, moderation: false, checkedAt,
          reason: error instanceof DirectTikTokError ? directErrorText(error) : 'De rechtstreekse ondertekenaar is niet beschikbaar. Controleer de serverinstellingen.' });
      }
    })().finally(() => { pending = undefined; });
    return pending;
  }

  const canSend = () => snapshot().chat;
  function pause(error:unknown):void {
    revision++;client=undefined;sendFailed=true;validUntil=0;sessionState=sessionFailure(error);
    update({state:'unknown',chat:false,moderation:false,checkedAt:value.checkedAt,
      reason:`${directErrorText(error)} Verzending is gepauzeerd; controleer de sessie en klik op Rechten opnieuw controleren.`});
  }
  async function send(text: string, roomId: string | undefined, active: () => boolean): Promise<unknown> {
    if (!client || !canSend() || !active()) throw new DirectTikTokError('inactive');
    if (!roomId || !/^\d{10,25}$/.test(roomId)) throw new DirectTikTokError('response');
    try {
      return await client.sendMessage(roomId, username, text, () => canSend() && active());
    } catch (error) {
      if (!(error instanceof DirectTikTokError && error.kind === 'inactive')) {
        pause(error);
      }
      throw error;
    }
  }
  async function withModeration<T>(operation: (moderation: ReturnType<typeof createDirectClient>['moderation']) => Promise<T>) {
    return run(async () => {
      if (!client || !canSend()) throw new DirectTikTokError('inactive');
      try{return await operation(client.moderation);}catch(error){if(needsManualSessionCheck(error))pause(error);throw error;}
    });
  }
  function setModerationAvailable(allowed: boolean) {
    if (value.moderation !== allowed) update({ ...value, moderation: allowed && canSend() });
  }
  return { snapshot, refresh, canSend, send: (text: string, roomId: string | undefined, active: () => boolean) => run(() => send(text, roomId, active)),
    withModeration, setModerationAvailable,botUserId:()=>client?.botUserId(),
    diagnostics:()=>{const sorted=timings.slice().sort((a,b)=>a-b);return {...signerStats,
      p50Ms:sorted.length?sorted[Math.ceil(sorted.length*.5)-1]:null,p95Ms:sorted.length?sorted[Math.ceil(sorted.length*.95)-1]:null};},
    close: () => { closed = true; revision++; client = undefined; controller.abort(); } };
}
export type DirectChat = ReturnType<typeof createDirectChat>;
