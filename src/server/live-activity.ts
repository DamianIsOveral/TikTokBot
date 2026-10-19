import type { IncomingActivity } from '../shared/events.ts';
import type { ActivitySourceEvent } from './types.ts';
import { publicIdentity } from './public-identity.ts';

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value !== null && typeof value === 'object' ? value as RecordValue : {};
const text = (value: unknown, max = 80): string => typeof value === 'string'
  ? value.replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim().slice(0, max) : '';
const count = (value: unknown): number => typeof value === 'number' && Number.isFinite(value)
  ? Math.min(1_000_000, Math.max(1, Math.floor(value))) : 1;

export function createLiveActivity() {
  const seen = new Map<string, number>();
  function remember(key: string, value: number): number {
    const previous = seen.get(key) || 0;
    seen.delete(key);
    seen.set(key, Math.max(previous, value));
    if (seen.size > 1000) seen.delete(seen.keys().next().value!);
    return previous;
  }
  return (source: ActivitySourceEvent, payload: unknown): IncomingActivity | undefined => {
    const data = record(payload);
    if (!Object.keys(data).length) return;
    const user = record(data.user);
    const name = text(user.uniqueId) || text(user.displayId) || text(user.nickname) || text(data.uniqueId) || 'Kijker';
    const identity = publicIdentity(user);
    if (source === 'member') {
      if (data.action !== undefined && data.action !== 0 && data.action !== 1) return;
      return { type: 'activity', kind: 'join', user: name, ...identity };
    }
    if (source !== 'gift') return { type: 'activity', kind: source, user: name, ...identity };
    const gift = record(data.gift);
    const extended = record(data.extendedGiftInfo);
    // Combo updates carry cumulative counts; show the completed streak only.
    if ((gift.type === 1 || gift.combo === true) && data.repeatEnd !== 1 && data.repeatEnd !== true) return;
    const amount = count(data.repeatCount);
    const group = text(data.groupId, 100);
    const messageId = text(record(data.common).msgId, 100);
    const actor = text(user.idStr, 100) || text(user.id, 100) || name;
    const giftId = text(data.giftId, 100) || text(gift.id, 100);
    const key = group && group !== '0' ? `group:${actor}:${giftId}:${group}` : messageId && messageId !== '0' ? `message:${messageId}` : '';
    const previous = key ? remember(key, amount) : 0;
    if (previous >= amount) return;
    return { type: 'activity', kind: 'gift', user: name, ...identity,
      gift: text(gift.name) || text(extended.name) || 'Cadeau', count: amount - previous };
  };
}
