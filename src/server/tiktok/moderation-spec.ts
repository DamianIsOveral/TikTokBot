export type ModerationAction = 'mute' | 'unmute' | 'ban' | 'unban';
export interface ModerationTarget { userId: string; secUid: string }
export type ModerationList = 'muted' | 'blocked';

const paths: Record<ModerationAction, string> = {
  mute: '/webcast/room/silence/', unmute: '/webcast/room/unsilence/',
  ban: '/webcast/room/kick/user/', unban: '/webcast/room/unkick/user/'
};
const listPaths: Record<ModerationList, string> = {
  muted: '/webcast/room/silence/list/', blocked: '/webcast/room/kick/list/'
};
const adminPath = '/webcast/user/admin/list/';
const userPath = '/webcast/user/';
const actionFields = ['room_id', 'user_id', 'sec_user_id', 'kick_uid', 'sec_kick_uid',
  'silence_type', 'duration', 'offset', 'count', 'cursor', 'anchor_id', 'sec_anchor_id',
  'current_room_id', 'owner_user_id', 'target_uid', 'request_from'];
const durations = new Set([0, 5, 30, 60, 300]);
const roomPattern = /^\d{10,25}$/;
const userPattern = /^\d{1,25}$/;
const secPattern = /^[\w.-]{1,256}$/;
const cursorPattern = /^\d{0,128}$/;

function invalid(): never { throw new Error('Ongeldige moderatieaanvraag.'); }
function checkString(value: unknown, pattern: RegExp): asserts value is string {
  if (typeof value !== 'string' || !pattern.test(value)) invalid();
}
function checkTarget(roomId: string, target: ModerationTarget): void {
  checkString(roomId, roomPattern);
  if (!target || typeof target !== 'object') invalid();
  checkString(target.userId, userPattern);
  checkString(target.secUid, secPattern);
}

export function buildModerationRequest(action: ModerationAction, roomId: string,
  target: ModerationTarget, duration = 30): {
    path: string; method: 'POST'; contentType: 'application/json' | 'application/x-www-form-urlencoded'; body: string
  } {
  if (!Object.hasOwn(paths, action) || !durations.has(duration)) invalid();
  checkTarget(roomId, target);
  if (action === 'unban') {
    const fields = new URLSearchParams({ kick_uid: target.userId, room_id: roomId, sec_kick_uid: target.secUid });
    return { path: paths[action], method: 'POST', contentType: 'application/x-www-form-urlencoded', body: fields.toString() };
  }
  const body = action === 'mute'
    ? { room_id: roomId, user_id: target.userId, silence_type: duration === 0 ? 0 : 1, sec_user_id: target.secUid, duration }
    : action === 'unmute' ? { room_id: roomId, user_id: target.userId, sec_user_id: target.secUid }
      : { room_id: roomId, kick_uid: target.userId, sec_kick_uid: target.secUid };
  return { path: paths[action], method: 'POST', contentType: 'application/json', body: JSON.stringify(body) };
}

export function buildModerationList(list: ModerationList, roomId: string, page = 0, cursor = ''): {
  path: string; query: Record<string, string>
} {
  if (!Object.hasOwn(listPaths, list) || !Number.isInteger(page) || page < 0 || page > 49) invalid();
  checkString(roomId, roomPattern);
  checkString(cursor, cursorPattern);
  if (list === 'blocked' && cursor !== '') invalid();
  const query: Record<string, string> = { room_id: roomId, offset: String(page * 20), count: '20' };
  if (list === 'muted') query.cursor = cursor;
  return { path: listPaths[list], query };
}

function checkQuery(url: URL, allowed: string[]): void {
  for (const field of actionFields) {
    const values = url.searchParams.getAll(field);
    if (values.length > 1 || (values.length && !allowed.includes(field))) invalid();
  }
}
function required(url: URL, name: string, pattern: RegExp): string {
  const values = url.searchParams.getAll(name);
  if (values.length !== 1) invalid();
  checkString(values[0], pattern);
  return values[0];
}

export function validateModerationSigning(url: URL, method: 'POST' | undefined,
  body: string | undefined, contentType?: string): boolean {
  const action = (Object.keys(paths) as ModerationAction[]).find(key => paths[key] === url.pathname);
  const list = (Object.keys(listPaths) as ModerationList[]).find(key => listPaths[key] === url.pathname);
  if (!action && !list && url.pathname !== adminPath && url.pathname !== userPath) return false;
  if (action) {
    checkQuery(url, []);
    if (method !== 'POST' || typeof body !== 'string' || body.length > 4096) invalid();
    let roomId: string;
    let target: ModerationTarget;
    let duration = 30;
    if (action === 'unban') {
      if (contentType !== 'application/x-www-form-urlencoded') invalid();
      const fields = new URLSearchParams(body);
      roomId = fields.get('room_id') ?? '';
      target = { userId: fields.get('kick_uid') ?? '', secUid: fields.get('sec_kick_uid') ?? '' };
    } else {
      if (contentType !== 'application/json') invalid();
      let value: Record<string, unknown>;
      try { value = JSON.parse(body); } catch { invalid(); }
      if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
      roomId = value.room_id as string;
      target = action === 'ban'
        ? { userId: value.kick_uid as string, secUid: value.sec_kick_uid as string }
        : { userId: value.user_id as string, secUid: value.sec_user_id as string };
      if (action === 'mute') {
        if (typeof value.duration !== 'number') invalid();
        duration = value.duration;
      }
    }
    const expected = buildModerationRequest(action, roomId, target, duration);
    if (expected.body !== body || expected.contentType !== contentType) invalid();
    return true;
  }
  if (method !== undefined || body !== undefined || contentType !== undefined) invalid();
  if (url.pathname === userPath) {
    checkQuery(url, ['current_room_id', 'owner_user_id', 'target_uid', 'request_from']);
    required(url, 'current_room_id', roomPattern);
    required(url, 'owner_user_id', userPattern);
    required(url, 'target_uid', userPattern);
    required(url, 'request_from', /^profile_card_v2$/);
    if (required(url, 'aid', /^1988$/) !== '1988') invalid();
    return true;
  }
  if (list) {
    checkQuery(url, ['room_id', 'offset', 'count', ...(list === 'muted' ? ['cursor'] : [])]);
    const roomId = required(url, 'room_id', roomPattern);
    const offset = required(url, 'offset', /^(0|[1-9]\d{0,2})$/);
    if (Number(offset) % 20 || required(url, 'count', /^20$/) !== '20') invalid();
    const cursor = url.searchParams.get('cursor') ?? '';
    buildModerationList(list, roomId, Number(offset) / 20, cursor);
    return true;
  }
  checkQuery(url, ['room_id', 'anchor_id', 'sec_anchor_id', 'sec_user_id']);
  required(url, 'room_id', roomPattern);
  required(url, 'anchor_id', userPattern);
  required(url, 'sec_anchor_id', secPattern);
  required(url, 'sec_user_id', secPattern);
  return true;
}
