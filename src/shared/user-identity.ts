export const avatarCdnDomains = ['tiktok.com', 'tiktokcdn.com', 'tiktokcdn-us.com', 'byteoversea.com', 'ibytedtos.com'];

export function safeAvatarUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2048 || /[\s\\\u0000-\u001f\u007f-\u009f]/u.test(value)) return;
  const authority = /^https:\/\/([^/?#]+)/i.exec(value)?.[1];
  if (!authority || /[:@]/.test(authority)) return;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return;
    if (!avatarCdnDomains.some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`))) return;
    return url.href.length <= 2048 ? url.href : undefined;
  } catch { return; }
}
