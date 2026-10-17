export interface BrowserContext {
  odinId?: string;
  webIdCreatedTime?: string;
  pageUserIdPresent?: boolean;
}

function digits(value: unknown): string | undefined {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) return undefined;
  const text = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  return /^\d{1,30}$/.test(text) ? text : undefined;
}

export function readBrowserContext(context: Record<string, unknown>): BrowserContext {
  const user = context.user && typeof context.user === 'object' ? context.user as Record<string, unknown> : {};
  return { odinId: digits(context.odinId), webIdCreatedTime: digits(context.webIdCreatedTime),
    pageUserIdPresent: !!(digits(user.uid) || digits(user.id) || digits(user.userId)) };
}

export function addBrowserParameters(url: URL, userAgent: string, context: BrowserContext, verifyFp?: string): void {
  const parameters = {
    browser_name: 'Mozilla', browser_version: userAgent.replace(/^Mozilla\//, ''),
    browser_platform: 'Linux x86_64', browser_language: 'en-US', browser_online: 'true',
    cookie_enabled: 'true', screen_width: '1920', screen_height: '1080',
    tz_name: Intl.DateTimeFormat().resolvedOptions().timeZone
  };
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
  if (context.odinId) url.searchParams.set('odinId', context.odinId);
  if (context.webIdCreatedTime) url.searchParams.set('WebIdLastTime', context.webIdCreatedTime);
  if (verifyFp) url.searchParams.set('verifyFp', verifyFp);
}

export function inspectBrowserContext(url: URL, cookies: ReadonlyMap<string, string>, context: BrowserContext) {
  const msTokenQueryPresent = !!url.searchParams.get('msToken');
  const browserParametersPresent = !!url.searchParams.get('browser_name') && !!url.searchParams.get('browser_version');
  return {
    msTokenCookiePresent: !!cookies.get('msToken'), msTokenQueryPresent,
    ttwidCookiePresent: !!cookies.get('ttwid'), verifyFpCookiePresent: !!cookies.get('s_v_web_id'),
    verifyFpQueryPresent: !!url.searchParams.get('verifyFp'), browserParametersPresent,
    odinIdFromPage: !!context.odinId, webIdCreatedTimeFromPage: !!context.webIdCreatedTime,
    pageUserIdPresent: !!context.pageUserIdPresent,
    inputStatus: msTokenQueryPresent && browserParametersPresent ? 'present' : 'incomplete'
  };
}
