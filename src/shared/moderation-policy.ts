interface Context {
  liveMode: boolean;
  serverConnected: boolean;
  phase: string;
  moderation?: { connected: boolean; enabled: boolean; mute: boolean; ban: boolean; reason: string };
}

export function moderationDisabledReason(context: Context, target: { userId?: string; secUid?: string }, action: 'mute' | 'ban'): string {
  if (!context.liveMode) return '';
  if (!context.serverConnected) return 'De verbinding met het dashboard is onderbroken.';
  if (context.phase !== 'connected') return 'Verbind eerst met TikTok LIVE.';
  const access = context.moderation;
  if (!access) return 'Moderatierechten worden gecontroleerd.';
  if (!access.connected || !access.enabled) return access.reason || 'Moderatie is niet beschikbaar.';
  if (!access[action]) return action === 'mute' ? 'Het botaccount heeft geen demprecht in deze LIVE.' : 'Het botaccount heeft geen blokkeerrecht in deze LIVE.';
  if (!target.userId || !target.secUid) return 'Gebruikersgegevens ontbreken bij dit bericht. Wacht op een nieuw LIVE-bericht.';
  return '';
}
