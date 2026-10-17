import type { TikTokMessage } from './types.ts';

export function chatIdentity(user: TikTokMessage['user']) {
  const validId = (value: unknown): value is string => typeof value === 'string' && /^[1-9]\d{0,24}$/.test(value);
  return {
    userId: validId(user?.idStr) ? user.idStr : validId(user?.id) ? user.id : undefined,
    secUid: typeof user?.secUid === 'string' && /^[\w.-]{1,256}$/.test(user.secUid) ? user.secUid : undefined
  };
}
