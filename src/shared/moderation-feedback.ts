export interface ModerationFeedbackEntry {
  userId: string;
  name: string;
  action: 'mute' | 'unmute' | 'ban' | 'unban';
  status: 'accepted' | 'uncertain';
  at: string;
  duration?: number;
  expiresAt?: number;
}

export interface ModerationFeedbackSnapshot {
  roomId: string | null;
  serverNow: number;
  entries: ModerationFeedbackEntry[];
}
