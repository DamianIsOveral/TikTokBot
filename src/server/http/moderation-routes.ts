import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DashboardUser } from '../../shared/auth.ts';
import type { AuditStore } from '../../shared/moderation.ts';
import type { AppConfig } from '../config.ts';
import type { DirectChat } from '../tiktok/direct-chat.ts';
import type { createLive } from '../live.ts';
import type { createSession } from '../session.ts';
import type { ModerationAction, ModerationTarget } from '../tiktok/moderation-spec.ts';
import { DirectTikTokError, directErrorText } from '../tiktok/direct-client.ts';
import { allowMutation } from './security.ts';
import { readJson } from './json.ts';
import { CommandError } from '../command-validation.ts';
import { auditedModeration, AuditOutcomeUnknownError } from '../moderation-action.ts';
import { OperationBusyError } from '../operation-queue.ts';
import { moderationFeedback } from '../moderation-feedback.ts';
import type { ModerationFeedbackSnapshot } from '../../shared/moderation-feedback.ts';

export function createModerationRoutes(config: AppConfig, direct: DirectChat | undefined,
  live: ReturnType<typeof createLive>, session: ReturnType<typeof createSession>, audit: AuditStore,
  changed?: (value: ModerationFeedbackSnapshot) => void) {
  let nextAction = 0;
  let cachedRoom: string | undefined;
  const targets = new Map<string, ModerationTarget>();
  return async function route(req: IncomingMessage, res: ServerResponse, user: DashboardUser, authorized: () => boolean): Promise<boolean> {
    const url = new URL(req.url || '/', 'http://localhost');
    if (!['/api/moderation', '/api/moderation/audit'].includes(url.pathname)) return false;
    res.setHeader('Content-Type', 'application/json');
    const feedback = () => moderationFeedback(audit, live.roomId);
    const reply = (status: number, value: Record<string, unknown>) => {
      res.writeHead(status).end(JSON.stringify({ ...value, ...(url.pathname === '/api/moderation' ? { moderation: feedback() } : {}) }));
    };
    if (url.pathname === '/api/moderation/audit') {
      if (req.method !== 'GET') reply(405, { error: 'Alleen lezen toegestaan.' });
      else reply(200, { entries: audit.list() });
      return true;
    }
    if (req.method !== 'GET' && !allowMutation(req, res)) return true;
    const roomId = live.roomId;
    if (cachedRoom !== roomId) { targets.clear(); cachedRoom = roomId; }
    if (!direct || !roomId) {
      reply(req.method === 'GET' ? 200 : 409, { connected: false, enabled: false, mute: false, ban: false,
        reason: !direct ? 'Directe moderatie is niet ingesteld.' : 'Verbind eerst met TikTok LIVE.' });
      return true;
    }
    try {
      let recordedRestore: string | undefined;
      const active = () => live.roomId === roomId && authorized() && (!recordedRestore || feedback().entries.some(item =>
        item.userId === recordedRestore && item.action === 'mute' && item.status === 'accepted'
        && (item.expiresAt === undefined || item.expiresAt > Date.now())));
      if (req.method === 'GET') {
        const kind = url.searchParams.get('list');
        const listKind = kind === 'muted' ? 'muted' : kind === 'blocked' ? 'blocked' : undefined;
        const page = Number(url.searchParams.get('page') || '0');
        const cursor = url.searchParams.get('cursor') || '';
        if (kind && !listKind) throw new CommandError('Ongeldige moderatielijst.');
        const rights = await direct.withModeration(mod => mod.access(config.username, roomId));
        direct.setModerationAvailable(config.moderationEnabled && (rights.mute || rights.ban));
        const list = listKind ? await direct.withModeration(mod => mod.list(config.username, roomId, listKind, page, cursor)) : undefined;
        reply(200, { connected: active(), enabled: config.moderationEnabled,
          mute: config.moderationEnabled && rights.mute, ban: config.moderationEnabled && rights.ban,
          reason: config.moderationEnabled ? 'Moderatie gebruikt de rechten van het botaccount.' : 'Moderatie staat uit op de server.', list });
        return true;
      }
      if (!config.moderationEnabled) throw new CommandError('Moderatie staat uit op de server.', 403);
      const body = await readJson(req) as Record<string, unknown>;
      if (!body || typeof body !== 'object' || !['mute', 'unmute', 'ban', 'unban'].includes(String(body.action))) throw new CommandError('Ongeldige moderatieactie.');
      const action = body.action as ModerationAction;
      if (Object.keys(body).some(key => !['action', 'messageId', 'targetId', 'page', 'cursor', 'duration'].includes(key))) throw new CommandError('Onbekend actieveld.');
      const duration = action === 'mute' && typeof body.duration === 'number' ? body.duration : action === 'mute' ? -1 : 30;
      if (action === 'mute' && ![0, 5, 30, 60, 300].includes(duration)) throw new CommandError('Ongeldige demptijd.');
      if (Date.now() < nextAction) throw new CommandError('Wacht drie seconden tussen moderatieacties.', 429);
      nextAction = Date.now() + 3000;
      let target: ModerationTarget;
      let name: string;
      if (action === 'mute' || action === 'ban') {
        const message = session.snapshot().messages.find(item => item.id === body.messageId);
        if (!message?.userId || !message.secUid) throw new CommandError('Dit LIVE-bericht mist geldige gebruikersgegevens.', 409);
        target = { userId: message.userId, secUid: message.secUid };
        name = message.user;
      } else {
        const kind = action === 'unmute' ? 'muted' : 'blocked';
        const list = await direct.withModeration(mod => mod.list(config.username, roomId, kind, Number(body.page || 0), String(body.cursor || '')));
        const entry = list.users.find(item => item.userId === body.targetId);
        if (entry) { target = entry; name = entry.name || entry.userId; }
        else {
          const recorded = action === 'unmute' && feedback().entries.find(item => item.userId === body.targetId
            && item.action === 'mute' && item.status === 'accepted' && (item.expiresAt === undefined || item.expiresAt > Date.now()));
          if (!recorded || !active()) throw new CommandError('De gebruiker staat niet meer op deze moderatielijst. Vernieuw de lijst.', 409);
          const message = session.snapshot().messages.find(item => item.userId === recorded.userId && item.secUid);
          const trusted = message?.secUid ? { userId: recorded.userId, secUid: message.secUid } : targets.get(recorded.userId);
          if (!trusted) throw new CommandError('Het dashboard kent deze demping, maar mist vertrouwde gebruikersgegevens om veilig te herstellen. Controleer TikTok.', 409);
          target = trusted;
          name = recorded.name;
          recordedRestore = recorded.userId;
        }
      }
      const before = audit.list(1)[0]?.id;
      let result: { accepted: true };
      try {
        result = await direct.withModeration(mod => auditedModeration(audit, {
          actor: { id: user.id, name: user.name.slice(0, 100) }, target: { id: target.userId, name: name.slice(0, 100) }, roomId,
          action, ...(action === 'mute' ? { duration } : {})
        }, () => mod.act(config.username, roomId, action, target, duration, active)));
        if (action === 'mute' && active()) {
          targets.delete(target.userId);
          targets.set(target.userId, { ...target });
          if (targets.size > 1000) targets.delete(targets.keys().next().value!);
        } else if (action === 'unmute') targets.delete(target.userId);
      } finally {
        const latest = audit.list(1)[0];
        if (latest && latest.id !== before && (latest.status === 'accepted' || latest.status === 'uncertain')) changed?.(feedback());
      }
      reply(200, result);
    } catch (error) {
      const status = error instanceof CommandError ? error.status : error instanceof OperationBusyError ? 429
        : error instanceof DirectTikTokError ? ['permission', 'target-role'].includes(error.kind) ? 403 : 502 : 503;
      reply(status, { error: error instanceof CommandError || error instanceof OperationBusyError || error instanceof AuditOutcomeUnknownError
        ? error.message : error instanceof DirectTikTokError ? directErrorText(error) : 'Moderatie kon niet veilig worden afgerond. Er is geen automatische herhaling.' });
    }
    return true;
  };
}
