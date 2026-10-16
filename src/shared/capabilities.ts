export interface EulerCapabilities {
  state: 'checking' | 'available' | 'unavailable' | 'unknown';
  chat: boolean;
  moderation: boolean;
  reason: string;
  checkedAt: string | null;
}
