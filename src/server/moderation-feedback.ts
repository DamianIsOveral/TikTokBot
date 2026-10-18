import type { AuditStore } from '../shared/moderation.ts';
import type { ModerationFeedbackEntry, ModerationFeedbackSnapshot } from '../shared/moderation-feedback.ts';

export function moderationFeedback(audit: Pick<AuditStore, 'list'>, roomId: string | undefined | null,
  now = Date.now()): ModerationFeedbackSnapshot {
  const entries: ModerationFeedbackEntry[] = [];
  const seen = new Set<string>();
  if (roomId) {
    const relevant = audit.list(1000).filter(entry => entry.roomId === roomId
      && (entry.status === 'accepted' || entry.status === 'uncertain'));
    relevant.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    for (const entry of relevant) {
      const key = `${entry.target.id}:${entry.action === 'mute' || entry.action === 'unmute' ? 'mute' : 'ban'}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({ userId: entry.target.id, name: entry.target.name, action: entry.action,
        status: entry.status as ModerationFeedbackEntry['status'], at: entry.at,
        ...(entry.action === 'mute' ? { duration: entry.duration,
          // This is the requested expiry, not a verified TikTok state.
          ...(entry.duration ? { expiresAt: Date.parse(entry.at) + entry.duration * 1000 } : {}) } : {}) });
    }
  }
  return { roomId: roomId || null, serverNow: now, entries };
}
