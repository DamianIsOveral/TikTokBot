import { DirectTikTokError } from './direct-client.ts';
import { buildModerationList, buildModerationRequest } from './moderation-spec.ts';
import type { ModerationAction, ModerationList, ModerationTarget } from './moderation-spec.ts';

type Json = Record<string, unknown>;
function object(value: unknown): Json { return value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}; }
interface RequestSpec { path: string; query?: Record<string, string>; method?: 'POST'; body?: string;
  contentType?: 'application/json' | 'application/x-www-form-urlencoded' }
interface Dependencies {
  verifyIdentity(): Promise<void>;
  readProfile(username: string): Promise<ModerationTarget & { username: string }>;
  resolveRoomId(username: string): Promise<string>;
  botUserId(): string;
  request(spec: RequestSpec, username: string, active?: () => boolean): Promise<Json>;
}

export function createDirectModeration(deps: Dependencies) {
  let permissions: { roomId: string; ownerId: string; mute: boolean; ban: boolean; until: number } | undefined;
  async function access(username: string, roomId: string) {
    if (permissions?.roomId === roomId && permissions.until > Date.now()) return { mute: permissions.mute, ban: permissions.ban };
    await deps.verifyIdentity();
    const owner = await deps.readProfile(username);
    const botId = deps.botUserId();
    if (!/^\d{1,25}$/.test(botId)) throw new DirectTikTokError('identity');
    const profile = await deps.request({ path: '/webcast/user/', query: {
      current_room_id: roomId, owner_user_id: owner.userId, target_uid: botId, request_from: 'profile_card_v2'
    } }, username);
    const data = object(profile.data);
    const user = object(data.user || data);
    if (user.id_str !== botId) throw new DirectTikTokError('response');
    const attr = object(user.user_attr);
    const rights = object(attr.admin_permissions);
    const host = botId === owner.userId;
    permissions = { roomId, ownerId: owner.userId, mute: host || (attr.is_admin === true && Number(rights['2']) > 0),
      ban: host || (attr.is_admin === true && Number(rights['3']) > 0), until: Date.now() + 30_000 };
    return { mute: permissions.mute, ban: permissions.ban };
  }

  async function list(username: string, roomId: string, kind: ModerationList, page = 0, cursor = '') {
    const rights = await access(username, roomId);
    if (kind === 'muted' ? !rights.mute : !rights.ban) throw new DirectTikTokError('permission');
    const result = await deps.request(buildModerationList(kind, roomId, page, cursor), username);
    if (!Array.isArray(result.data) || result.data.length > 20) throw new DirectTikTokError('response');
    const users = result.data.map(raw => {
      const user = object(raw);
      if (typeof user.id_str !== 'string' || !/^\d{1,25}$/.test(user.id_str)
        || typeof user.sec_uid !== 'string' || !/^[\w.-]{1,256}$/.test(user.sec_uid)) throw new DirectTikTokError('response');
      return { userId: user.id_str, secUid: user.sec_uid, name: String(user.nickname || '').slice(0, 100) };
    });
    const extra = object(result.extra);
    return { users, hasMore: extra.has_more === true || extra.has_more === 1,
      cursor: typeof extra.next_cursor === 'string' && /^\d{0,128}$/.test(extra.next_cursor) ? extra.next_cursor
        : typeof extra.next_cursor === 'number' && Number.isSafeInteger(extra.next_cursor) && extra.next_cursor >= 0 ? String(extra.next_cursor) : '' };
  }

  async function targetStatus(username: string, roomId: string, target: ModerationTarget) {
    await access(username, roomId);
    const result = await deps.request({ path: '/webcast/user/', query: { current_room_id: roomId,
      owner_user_id: permissions!.ownerId, target_uid: target.userId, request_from: 'profile_card_v2' } }, username);
    const data = object(result.data);
    const user = object(data.user || data);
    if (user.id_str !== target.userId) throw new DirectTikTokError('response');
    const attr = object(user.user_attr);
    return { moderator: attr.is_admin === true, muted: attr.is_muted === true };
  }

  async function act(username: string, roomId: string, action: ModerationAction, target: ModerationTarget,
    duration = 30, active: () => boolean = () => true) {
    const spec = buildModerationRequest(action, roomId, target, duration);
    const rights = await access(username, roomId);
    if (target.userId === deps.botUserId() || target.userId === permissions?.ownerId) throw new DirectTikTokError('permission');
    if (action === 'mute' || action === 'unmute' ? !rights.mute : !rights.ban) throw new DirectTikTokError('permission');
    if ((action === 'mute' || action === 'ban') && deps.botUserId() !== permissions?.ownerId) {
      const status = await targetStatus(username, roomId, target);
      if (status.moderator) throw new DirectTikTokError('target-role');
    }
    await deps.request(spec, username, active);
    return { accepted: true as const };
  }
  return { access, list, act, targetStatus, resolveTarget: deps.readProfile, resolveRoomId: deps.resolveRoomId };
}
