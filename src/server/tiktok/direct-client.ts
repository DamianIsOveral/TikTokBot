import { parseWebcastCsrf } from './csrf.ts';
import { assertSigningVersion, signingSdkVersion, signingUserAgent, validateSignedUrl } from './signing-profile.ts';
import type { DirectRequestSigner } from './signing-profile.ts';

export interface DirectCredentials { sessionId: string; targetIdc: string; botUsername: string }
export type DirectFailure = 'session' | 'identity' | 'challenge' | 'csrf' | 'signing' | 'signing-version' | 'rejected' | 'empty' | 'network' | 'response';

export class DirectTikTokError extends Error {
  readonly kind: DirectFailure;
  readonly status?: number;
  readonly apiCode?: number;
  constructor(kind: DirectFailure, status?: number, apiCode?: number) {
    super('Rechtstreekse TikTok-aanvraag mislukt.');
    this.name = 'DirectTikTokError';
    this.kind = kind;
    this.status = status;
    this.apiCode = apiCode;
  }
}

type JsonObject = Record<string, unknown>;
function object(value: unknown): JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

export function directErrorText(error: unknown): string {
  const kind = error instanceof DirectTikTokError ? error.kind : 'network';
  const messages: Record<DirectFailure, string> = {
    session: 'TikTok herkent de botsessie niet. Controleer de botcookies.',
    identity: 'De TikTok-sessie hoort niet bij het ingestelde botaccount. Verzenden is geblokkeerd.',
    challenge: 'TikTok vraagt browserverificatie. De rechtstreekse proef is gestopt.',
    csrf: 'TikTok weigert de CSRF-validatie. De rechtstreekse actie is gestopt.',
    signing: 'Lokale TikTok-ondertekening is mislukt. Er is niets verstuurd.',
    'signing-version': 'TikTok gebruikt een onbekende ondertekeningsversie. De proef is gestopt.',
    rejected: 'TikTok heeft het rechtstreekse verzoek geweigerd.',
    empty: 'TikTok geeft een leeg antwoord. De rechtstreekse actie is niet bevestigd.',
    network: 'TikTok is rechtstreeks niet bereikbaar. Er wordt niet automatisch opnieuw verstuurd.',
    response: 'TikTok geeft een onbekend antwoord. De rechtstreekse actie is niet bevestigd.'
  };
  return messages[kind];
}

export function createDirectClient(credentials: DirectCredentials, request: typeof fetch = fetch,
  options: { signRequest?: DirectRequestSigner } = {}) {
  for (const value of [credentials.sessionId, credentials.targetIdc]) {
    if (!value || /[\s;\r\n]/.test(value)) throw new DirectTikTokError('session');
  }
  if (!/^[\w.]{1,24}$/.test(credentials.botUsername)) throw new DirectTikTokError('identity');
  const cookies = new Map<string, string>([
    ['sessionid', credentials.sessionId], ['sessionid_ss', credentials.sessionId],
    ['sid_tt', credentials.sessionId], ['tt-target-idc', credentials.targetIdc]
  ]);
  let verifiedUntil = 0;
  let csrfToken = '';
  let deviceId = '';
  let preparedFor = '';
  let webcastCsrf: ReturnType<typeof parseWebcastCsrf> | undefined;
  const userAgent = options.signRequest ? signingUserAgent
    : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

  async function raw(url: URL, method: 'GET' | 'POST' | 'HEAD', referer: string): Promise<Response> {
    if (!['https://www.tiktok.com', 'https://webcast.tiktok.com'].includes(url.origin)) {
      throw new DirectTikTokError('response');
    }
    let response: Response;
    try {
      response = await request(url, { method, redirect: 'error', signal: AbortSignal.timeout(10_000),
        headers: {
          Cookie: [...cookies].filter(([key]) => key !== 'csrf_session_id' || url.hostname === 'webcast.tiktok.com')
            .map(([key, value]) => `${key}=${value}`).join('; '),
          'User-Agent': userAgent,
          Accept: 'application/json', Referer: referer,
          ...(method !== 'GET' ? { Origin: 'https://www.tiktok.com' } : {}),
          ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
          ...(method === 'POST' && !options.signRequest && csrfToken ? { 'tt-csrf-token': csrfToken } : {}),
          ...(method === 'POST' && options.signRequest && webcastCsrf ? { 'x-secsdk-csrf-token': webcastCsrf.token } : {}),
          ...(method === 'HEAD' ? { 'x-secsdk-csrf-request': '1', 'x-secsdk-csrf-version': '1.2.22' } : {}),
          ...(cookies.has('passport_csrf_token') ? { 'x-tt-passport-csrf-token': cookies.get('passport_csrf_token')! } : {})
        }
      });
    } catch { throw new DirectTikTokError('network'); }
    if (response.headers.get('x-tt-verify-id')) throw new DirectTikTokError('challenge', response.status);
    if (!response.ok) {
      let apiCode: number | undefined;
      let csrf = false;
      try {
        const text = await readText(response, 65_536);
        csrf = /csrf/i.test(text);
        const json = object(JSON.parse(text));
        const code = json.status_code ?? object(json.data).error_code;
        if (typeof code === 'number' && Number.isSafeInteger(code)) apiCode = code;
      } catch {}
      throw new DirectTikTokError(csrf ? 'csrf' : 'rejected', response.status, apiCode);
    }
    for (const header of response.headers.getSetCookie()) {
      const pair = header.split(';')[0];
      const equals = pair.indexOf('=');
      const name = pair.slice(0, equals);
      const value = pair.slice(equals + 1);
      if (['passport_csrf_token', 'passport_csrf_token_default', 'tt_csrf_token', 'tt_chain_token', 'ttwid', 'msToken', 'csrf_session_id'].includes(name)
        && value && !/[\r\n;]/.test(value)) cookies.set(name, value);
    }
    return response;
  }

  async function readText(response: Response, limit: number): Promise<string> {
    const reader = response.body?.getReader();
    if (!reader) throw new DirectTikTokError('empty', response.status);
    let text = '';
    const decoder = new TextDecoder();
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        text += decoder.decode(chunk.value, { stream: true });
        if (text.length > limit) { await reader.cancel(); throw new DirectTikTokError('response', response.status); }
      }
    } catch (error) {
      throw error instanceof DirectTikTokError ? error : new DirectTikTokError('network');
    } finally { reader.releaseLock(); }
    if (!text.trim()) throw new DirectTikTokError('empty', response.status);
    return text;
  }

  async function call(url: URL, method: 'GET' | 'POST', referer: string): Promise<JsonObject> {
    const response = await raw(url, method, referer);
    const text = await readText(response, 65_536);
    try { return object(JSON.parse(text)); }
    catch { throw new DirectTikTokError('response', response.status); }
  }

  async function verifyIdentity(): Promise<void> {
    verifiedUntil = 0;
    const json = await call(new URL('https://www.tiktok.com/passport/web/account/info/?aid=1988'), 'GET', 'https://www.tiktok.com/');
    const data = object(json.data);
    if (typeof data.username !== 'string' || !data.user_id || data.error_code) throw new DirectTikTokError('session');
    if (data.username.toLowerCase() !== credentials.botUsername.toLowerCase()) throw new DirectTikTokError('identity');
    verifiedUntil = Date.now() + 5 * 60_000;
  }

  async function resolveRoomId(username: string): Promise<string> {
    if (!/^[\w.]{1,24}$/.test(username)) throw new DirectTikTokError('response');
    const url = new URL('https://www.tiktok.com/api-live/user/room/');
    url.search = new URLSearchParams({ aid: '1988', uniqueId: username, sourceType: '54' }).toString();
    const json = await call(url, 'GET', `https://www.tiktok.com/@${username}/live`);
    const id = object(object(json.data).user).roomId;
    if (json.statusCode || typeof id !== 'string' || !/^\d{10,25}$/.test(id)) throw new DirectTikTokError('response');
    return id;
  }

  async function prepareLive(username: string): Promise<void> {
    csrfToken = '';
    deviceId = '';
    preparedFor = '';
    webcastCsrf = undefined;
    const response = await raw(new URL(`https://www.tiktok.com/@${username}/live`), 'GET', 'https://www.tiktok.com/');
    const html = await readText(response, 2_000_000);
    if (options.signRequest) {
      try { assertSigningVersion(html); }
      catch { throw new DirectTikTokError('signing-version'); }
    }
    const match = html.match(/<script[^>]*id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
    let context: JsonObject;
    try {
      const json = object(JSON.parse(match?.[1] || ''));
      context = object(object(json.__DEFAULT_SCOPE__)['webapp.app-context']);
    } catch { throw new DirectTikTokError('response'); }
    if (typeof context.csrfToken !== 'string' || !context.csrfToken || /[\r\n]/.test(context.csrfToken)
      || context.csrfToken.length > 512 || typeof context.wid !== 'string' || !/^\d{5,30}$/.test(context.wid)) {
      throw new DirectTikTokError('response');
    }
    csrfToken = context.csrfToken;
    deviceId = context.wid;
    preparedFor = username;
  }

  async function prepareMessage(roomId: string, username: string, content: string) {
    if (!/^\d{10,25}$/.test(roomId) || !/^[\w.]{1,24}$/.test(username)
      || !content.trim() || content.length > 200 || /[\r\n\x00]/.test(content)) {
      throw new DirectTikTokError('response');
    }
    if (Date.now() >= verifiedUntil) await verifyIdentity();
    if (preparedFor !== username) await prepareLive(username);
    const url = new URL('https://webcast.tiktok.com/webcast/room/chat/');
    url.search = new URLSearchParams({ aid: '1988', app_name: 'tiktok_web', device_platform: 'web_pc',
      device_id: deviceId, room_id: roomId, content }).toString();
    let measurements: { signMs: number; rssMiB: number } | undefined;
    if (options.signRequest) {
      url.searchParams.set('input_type', '0');
      url.searchParams.set('emotes_with_index', '');
      if (!webcastCsrf) {
        const response = await raw(new URL('https://webcast.tiktok.com/webcast/room/chat/'), 'HEAD', `https://www.tiktok.com/@${username}/live`);
        try { webcastCsrf = parseWebcastCsrf(response.headers.get('x-ware-csrf-token')); }
        catch { throw new DirectTikTokError('csrf'); }
      }
      try {
        const input = { url: url.href, userAgent, msToken: cookies.get('msToken'),
          cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; ') };
        const result = await options.signRequest(input);
        validateSignedUrl(input, result.signedUrl);
        measurements = { signMs: result.signMs, rssMiB: result.rssMiB };
        return { url: new URL(result.signedUrl), measurements };
      } catch { throw new DirectTikTokError('signing'); }
    }
    return { url, measurements };
  }

  async function inspectMessage(roomId: string, username: string, content: string) {
    const prepared = await prepareMessage(roomId, username, content);
    return { sent: false, queryFields: [...prepared.url.searchParams.keys()],
      csrfMode: webcastCsrf?.mode ?? 'page-token', scriptVersion: options.signRequest ? signingSdkVersion : undefined,
      ...prepared.measurements };
  }

  async function sendMessage(roomId: string, username: string, content: string): Promise<{ messageId: string | null }> {
    const { url } = await prepareMessage(roomId, username, content);
    const json = await call(url, 'POST', `https://www.tiktok.com/@${username}/live`);
    if (json.status_code !== 0) throw new DirectTikTokError('rejected', 200,
      typeof json.status_code === 'number' ? json.status_code : undefined);
    const data = object(json.data);
    const id = data.msg_id ?? data.id_str;
    return { messageId: typeof id === 'string' && /^\d+$/.test(id) ? id : null };
  }

  return { verifyIdentity, resolveRoomId, inspectMessage, sendMessage };
}
