const queryNames = [
  'WebIdLastTime', 'aid', 'app_language', 'app_name', 'browser_language', 'browser_name',
  'browser_online', 'browser_platform', 'browser_version', 'channel', 'cookie_enabled',
  'client_start_timestamp_millisecond', 'emotes_with_index', 'input_type',
  'cpu_number', 'data_collection_enabled', 'device_id', 'device_platform', 'device_type',
  'focus_state', 'from_page', 'history_len', 'is_fullscreen', 'is_page_visible',
  'os', 'priority_region', 'referer', 'region', 'room_id', 'root_referer', 'screen_height',
  'screen_width', 'tz_name', 'user_is_login', 'verifyFp', 'webcast_language', 'odinId',
  'msToken', 'X-Bogus', 'X-Gnarly', 'X-Dynosaur', '_signature', 'content', 'anchor_id',
  'user_id', 'emote_id', 'enter_from', 'enter_method', 'comment_msg_id', 'duration'
];
const allowedQuery = new Map(queryNames.map(name => [name.toLowerCase(), name]));
const allowedHeaders = new Set([
  'accept', 'accept-language', 'accept-encoding', 'content-type', 'content-length', 'cookie',
  'origin', 'referer', 'user-agent', 'tt-csrf-token', 'x-tt-passport-csrf-token',
  'x-secsdk-csrf-token', 'x-secsdk-csrf-version', 'sec-fetch-site', 'sec-fetch-mode',
  'sec-fetch-dest', 'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform', 'cache-control', 'pragma'
]);
const signatures = new Set(['X-Bogus', 'X-Gnarly', 'X-Dynosaur', '_signature']);

export interface ChatRequestShape {
  method: 'GET' | 'POST' | 'OPTIONS';
  origin: 'https://webcast.tiktok.com' | 'https://www.tiktok.com';
  path: '/webcast/room/chat/';
  httpStatus: number | null;
  apiStatusCode: number | null;
  queryFields: string[];
  bodyFields: string[];
  headerFields: string[];
  signatureFields: string[];
  unknownQueryFieldCount: number;
  unknownBodyFieldCount: number;
  unknownHeaderFieldCount: number;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function names(value: unknown): string[] {
  return Array.isArray(value) ? value.map(item => record(item).name).filter((name): name is string => typeof name === 'string') : [];
}

function fields(input: string[]): { known: string[]; unknownCount: number } {
  const known = new Set<string>();
  let unknownCount = 0;
  for (const name of new Set(input)) {
    const canonical = allowedQuery.get(name.toLowerCase());
    if (canonical) known.add(canonical);
    else unknownCount++;
  }
  return { known: [...known].sort(), unknownCount };
}

function apiStatusCode(response: Record<string, unknown>): number | null {
  const content = record(response.content);
  if (content.encoding || typeof content.text !== 'string' || content.text.length > 262_144) return null;
  try {
    const status = record(JSON.parse(content.text)).status_code;
    return typeof status === 'number' && Number.isInteger(status) && Math.abs(status) <= 2_147_483_647 ? status : null;
  } catch { return null; }
}

export function inspectTikTokHar(har: unknown): ChatRequestShape[] {
  const entries = record(record(har).log).entries;
  if (!Array.isArray(entries) || entries.length > 100_000) throw new Error('HAR bevat geen geldige verzoekenlijst.');
  const result: ChatRequestShape[] = [];
  for (const entry of entries) {
    const request = record(record(entry).request);
    if (typeof request.url !== 'string') continue;
    let url: URL;
    try { url = new URL(request.url); } catch { continue; }
    if (!['https://webcast.tiktok.com', 'https://www.tiktok.com'].includes(url.origin)
      || url.pathname !== '/webcast/room/chat/' || url.username || url.password) continue;
    if (!['GET', 'POST', 'OPTIONS'].includes(String(request.method))) continue;
    const query = fields([...url.searchParams.keys(), ...names(request.queryString)]);
    const post = record(request.postData);
    let bodyNames = names(post.params);
    if (typeof post.text === 'string' && typeof post.mimeType === 'string'
      && post.mimeType.split(';')[0].trim().toLowerCase() === 'application/x-www-form-urlencoded') {
      bodyNames = [...bodyNames, ...new URLSearchParams(post.text).keys()];
    }
    const body = fields(bodyNames);
    const rawHeaders = [...new Set(names(request.headers).map(name => name.toLowerCase()))];
    const headerFields = rawHeaders.filter(name => allowedHeaders.has(name)).sort();
    const response = record(record(entry).response);
    const status = response.status;
    result.push({
      method: request.method as ChatRequestShape['method'], origin: url.origin as ChatRequestShape['origin'],
      path: '/webcast/room/chat/', httpStatus: typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
      apiStatusCode: apiStatusCode(response),
      queryFields: query.known, bodyFields: body.known, headerFields,
      signatureFields: query.known.filter(name => signatures.has(name)),
      unknownQueryFieldCount: query.unknownCount, unknownBodyFieldCount: body.unknownCount,
      unknownHeaderFieldCount: rawHeaders.length - headerFields.length
    });
    if (result.length >= 100) break;
  }
  return result;
}
