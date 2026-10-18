export const allowedSessionCookies = new Set(['sessionid', 'sessionid_ss', 'sid_tt', 'tt-target-idc', 'passport_csrf_token',
  'passport_csrf_token_default', 'tt_csrf_token', 'tt_chain_token', 'ttwid', 'msToken', 'csrf_session_id',
  's_v_web_id', 'odin_tt', 'tt-target-idc-sign']);
export type CookieSnapshot=Record<string,{value:string;expires?:number}|null>;

export function createBotCookies(credentials:{sessionId:string;targetIdc:string;msToken?:string;verifyFp?:string},now=Date.now) {
  return createSessionCookies([['sessionid',credentials.sessionId],['sessionid_ss',credentials.sessionId],
    ['sid_tt',credentials.sessionId],['tt-target-idc',credentials.targetIdc],
    ...(credentials.msToken?[['msToken',credentials.msToken] as [string,string]]:[]),
    ...(credentials.verifyFp?[['s_v_web_id',credentials.verifyFp] as [string,string]]:[])],now);
}

export function createSessionCookies(initial: Iterable<[string, string]>, now = Date.now) {
  const cookies = new Map(initial);
  const expires = new Map<string, number>();
  const deleted=new Set<string>();

  function prune(): void {
    for (const [name, expiry] of expires) {
      if (now() >= expiry) { cookies.delete(name); expires.delete(name); deleted.add(name); }
    }
  }

  function absorb(headers: Headers): void {
    for (const header of headers.getSetCookie()) {
      const [pair, ...attributes] = header.split(';');
      const equals = pair.indexOf('=');
      const name = pair.slice(0, equals).trim();
      const value = pair.slice(equals + 1);
      if (equals <= 0 || !allowedSessionCookies.has(name) || value.length > 8192 || /[\r\n\x00]/.test(value)) continue;
      let expiry: number | undefined;
      let maxAge: number | undefined;
      for (const attribute of attributes) {
        const at = attribute.indexOf('=');
        const key = attribute.slice(0, at).trim().toLowerCase();
        const text = attribute.slice(at + 1).trim();
        if (key === 'max-age' && /^-?\d+$/.test(text) && Number.isSafeInteger(Number(text))) maxAge = Number(text);
        if (key === 'expires' && Number.isFinite(Date.parse(text))) expiry = Date.parse(text);
      }
      if (maxAge !== undefined) expiry = Math.max(-8.64e15,Math.min(8.64e15,now() + maxAge * 1000));
      if (!value || (expiry !== undefined && expiry <= now())) {
        cookies.delete(name); expires.delete(name); deleted.add(name);
      } else {
        deleted.delete(name);
        cookies.set(name, value);
        if (expiry !== undefined) expires.set(name, expiry);
        else expires.delete(name);
      }
    }
    prune();
  }
  function restore(state:CookieSnapshot):void {
    for(const [name,entry] of Object.entries(state)) {
      if(!allowedSessionCookies.has(name))continue;
      cookies.delete(name);expires.delete(name);
      if(entry){cookies.set(name,entry.value);deleted.delete(name);if(entry.expires!==undefined)expires.set(name,entry.expires);}
      else deleted.add(name);
    }
    prune();
  }
  function snapshot():CookieSnapshot {
    prune();
    return Object.fromEntries([...new Set([...cookies.keys(),...deleted])].sort().map(name=>[name,
      cookies.has(name)?{value:cookies.get(name)!,...(expires.has(name)?{expires:expires.get(name)}:{})}:null]));
  }
  return { cookies, absorb, prune,restore,snapshot };
}
export type SessionCookies=ReturnType<typeof createSessionCookies>;
