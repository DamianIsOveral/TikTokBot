export interface ChatCapabilities {
  state: 'checking' | 'available' | 'unavailable' | 'unknown';
  chat: boolean;
  moderation: boolean;
  reason: string;
  checkedAt: string | null;
  session?:{state:'checking'|'healthy'|'stale'|'challenged'|'rate-limited'|'invalid'|'unavailable'|'stopped';
    persistent:boolean;cookieUpdatedAt:string|null};
}
