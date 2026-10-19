import {safeAvatarUrl} from '../shared/user-identity.ts';
export {safeAvatarUrl} from '../shared/user-identity.ts';
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object'
  ? value as Record<string, unknown> : {};

export function publicIdentity(value: unknown): { displayName?: string; avatarUrl?: string } {
  const user = record(value);
  const displayName = typeof user.nickname === 'string'
    ? user.nickname.replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim().slice(0, 80) : '';
  const sources = [record(user.avatarThumb).urlList, record(user.profilePicture).url];
  let avatarUrl: string | undefined;
  for (const source of sources) {
    if (!Array.isArray(source)) continue;
    for (const candidate of source.slice(0, 10)) {
      avatarUrl = safeAvatarUrl(candidate);
      if (avatarUrl) break;
    }
    if (avatarUrl) break;
  }
  return { ...(displayName ? { displayName } : {}), ...(avatarUrl ? { avatarUrl } : {}) };
}
