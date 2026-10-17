const allowed = new Set(['sessionid', 'sessionid_ss', 'sid_tt', 'tt-target-idc', 'passport_csrf_token',
  'passport_csrf_token_default', 'tt_csrf_token', 'tt_chain_token', 'ttwid', 'msToken', 'csrf_session_id',
  's_v_web_id', 'odin_tt', 'tt-target-idc-sign']);

export function createSessionCookies(initial: Iterable<[string, string]>, now = Date.now) {
  const cookies = new Map(initial);
  const expires = new Map<string, number>();

  function prune(): void {
    for (const [name, expiry] of expires) {
      if (now() >= expiry) { cookies.delete(name); expires.delete(name); }
    }
  }

  function absorb(headers: Headers): void {
    for (const header of headers.getSetCookie()) {
      const [pair, ...attributes] = header.split(';');
      const equals = pair.indexOf('=');
      const name = pair.slice(0, equals).trim();
      const value = pair.slice(equals + 1);
      if (equals <= 0 || !allowed.has(name) || value.length > 8192 || /[\r\n\x00]/.test(value)) continue;
      let expiry: number | undefined;
      let maxAge: number | undefined;
      for (const attribute of attributes) {
        const at = attribute.indexOf('=');
        const key = attribute.slice(0, at).trim().toLowerCase();
        const text = attribute.slice(at + 1).trim();
        if (key === 'max-age' && /^-?\d+$/.test(text) && Number.isSafeInteger(Number(text))) maxAge = Number(text);
        if (key === 'expires' && Number.isFinite(Date.parse(text))) expiry = Date.parse(text);
      }
      if (maxAge !== undefined) expiry = now() + maxAge * 1000;
      if (!value || (expiry !== undefined && expiry <= now())) {
        cookies.delete(name); expires.delete(name);
      } else {
        cookies.set(name, value);
        if (expiry !== undefined) expires.set(name, expiry);
        else expires.delete(name);
      }
    }
    prune();
  }
  return { cookies, absorb, prune };
}
