export interface CommandLimiterStatus {
  serverNow: number;
  busy: boolean;
  nextReadyAt: number | null;
  intervalReadyAt: number;
  batchReadyAt: number;
  minute: { remaining: number; limit: number; nextReadyAt: number };
  hour: { remaining: number; limit: number; nextReadyAt: number };
  triggerCooldowns: { trigger: string; nextReadyAt: number }[];
  userCooldownSeconds: number;
}

export interface CommandStatus extends CommandLimiterStatus {
  state: 'ready' | 'cooldown' | 'responding' | 'disabled' | 'disconnected' | 'session-unavailable';
}
