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
import { randomUUID } from 'node:crypto';
import { createModerationErrorReports, logModerationFailure, moderationOperation, moderationReference } from '../moderation-errors.ts';

export function createModerationRoutes(config: AppConfig, direct: DirectChat | undefined,
  live: ReturnType<typeof createLive>, session: ReturnType<typeof createSession>, audit: AuditStore,
  changed?: (value: ModerationFeedbackSnapshot) => void) {
  let nextAction = 0;
  let cachedRoom: string | undefined;
  const targets = new Map<string, ModerationTarget>();
  const reportError = createModerationErrorReports();
  return async function route(req: IncomingMessage, res: ServerResponse, user: DashboardUser, authorized: () => boolean): Promise<boolean> {
    const url = new URL(req.url || '/', 'http://localhost');
    if (!['/api/moderation', '/api/moderation/audit', '/api/moderation/errors'].includes(url.pathname)) return false;
    const suppliedReference = req.headers['x-request-id'];
    const reference = moderationReference(suppliedReference) ? suppliedReference : randomUUID();
    res.setHeader('X-Request-ID', reference);
    res.setHeader('Content-Type', 'application/json');
    if (url.pathname === '/api/moderation/errors') { await reportError(req, res); return true; }
    let operation = url.pathname.endsWith('/audit') ? moderationOperation('audit')
      : req.method === 'GET' ? moderationOperation(url.searchParams.get('list') === 'muted' ? 'muted-list'
        : url.searchParams.get('list') === 'blocked' ? 'blocked-list' : 'access') : undefined;
    const feedback = () => moderationFeedback(audit, live.roomId);
    const reply = (status: number, value: Record<string, unknown>, error?: unknown) => {
      if (status >= 400) logModerationFailure(reference, operation, status, error, value.partial === true);
      res.writeHead(status).end(JSON.stringify({ ...value, ...(status >= 400 ? { reference } : {}),
        ...(url.pathname === '/api/moderation' ? { moderation: feedback() } : {}) }));
    };
    if (url.pathname === '/api/moderation/audit') {
      if (req.method !== 'GET') reply(405, { error: 'Alleen lezen toegestaan.' });
      else reply(200, { entries: audit.list() });
      return true;
    }
    if (req.method !== 'GET' && !allowMutation(req, res)) {
      logModerationFailure(reference, operation, res.statusCode); return true;
    }
    const roomId = live.roomId;
    if (cachedRoom !== roomId) { targets.clear(); cachedRoom = roomId; }
    if (!direct || !roomId) {
      reply(req.method === 'GET' ? 200 : 409, { connected: false, enabled: false, mute: false, ban: false,
        reason: !direct ? 'Directe moderatie is niet ingesteld.' : 'Verbind eerst met TikTok LIVE.' });
      return true;
    }
    let acceptedMute = false;
    try {
      let recordedRestore: { userId: string; action: 'mute' | 'ban' } | undefined;
      const restriction = (userId: unknown, action: 'mute' | 'ban') => feedback().entries.find(item =>
        item.userId === userId && item.action === action && item.status === 'accepted'
        && (item.expiresAt === undefined || item.expiresAt > Date.now()));
      const active = () => live.roomId === roomId && authorized() && (!recordedRestore
        || Boolean(restriction(recordedRestore.userId, recordedRestore.action)));
      const identity = (userId: string) => {
        const message = session.snapshot().messages.findLast(item => item.userId === userId);
        const previous = audit.list(1000).filter(item => item.roomId === roomId && item.target.id === userId);
        return { username: message?.user || previous.find(item => item.action === 'mute' || item.action === 'ban')?.target.name,
          displayName: message?.displayName || previous.find(item => item.target.displayName)?.target.displayName };
      };
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
          reason: config.moderationEnabled ? 'Moderatie gebruikt de rechten van het botaccount.' : 'Moderatie staat uit op de server.',
          list: list && { ...list, users: list.users.map(entry => ({ ...entry, ...identity(entry.userId) })) } });
        return true;
      }
      if (!config.moderationEnabled) throw new CommandError('Moderatie staat uit op de server.', 403);
      const body = await readJson(req) as Record<string, unknown>;
      if (!body || typeof body !== 'object' || !['mute', 'unmute', 'ban', 'unban', 'mute-ban'].includes(String(body.action))) throw new CommandError('Ongeldige moderatieactie.');
      const action = body.action as ModerationAction | 'mute-ban';
      operation = moderationOperation(action);
      const muting = action === 'mute' || action === 'mute-ban';
      if (Object.keys(body).some(key => !['action', 'messageId', 'targetId', 'page', 'cursor', 'duration', 'recorded'].includes(key))) throw new CommandError('Onbekend actieveld.');
      if (body.recorded !== undefined && (typeof body.recorded !== 'boolean' || muting || action === 'ban')) throw new CommandError('Ongeldig herstelveld.');
      const duration = muting && typeof body.duration === 'number' ? body.duration : muting ? -1 : 30;
      if (muting && ![0, 5, 30, 60, 300].includes(duration)) throw new CommandError('Ongeldige demptijd.');
      if (Date.now() < nextAction) throw new CommandError('Wacht drie seconden tussen moderatieacties.', 429);
      nextAction = Date.now() + 3000;
      let target: ModerationTarget;
      let name: string;
      let displayName: string | undefined;
      if (muting || action === 'ban') {
        const message = session.snapshot().messages.find(item => item.id === body.messageId);
        if (!message?.userId || !message.secUid) throw new CommandError('Dit LIVE-bericht mist geldige gebruikersgegevens.', 409);
        target = { userId: message.userId, secUid: message.secUid };
        name = message.user;
        displayName = message.displayName;
      } else {
        const kind = action === 'unmute' ? 'muted' : 'blocked';
        const list = body.recorded === true ? undefined
          : await direct.withModeration(mod => mod.list(config.username, roomId, kind, Number(body.page || 0), String(body.cursor || '')));
        const entry = list?.users.find(item => item.userId === body.targetId);
        if (entry) { target = entry; name = identity(entry.userId).username || entry.name || entry.userId; }
        else {
          const axis = action === 'unmute' ? 'mute' : 'ban';
          const recorded = restriction(body.targetId, axis);
          if (!recorded || !active()) throw new CommandError('De gebruiker staat niet meer op deze moderatielijst. Vernieuw de lijst.', 409);
          const message = session.snapshot().messages.findLast(item => item.userId === recorded.userId && item.secUid);
          const trusted = message?.secUid ? { userId: recorded.userId, secUid: message.secUid } : targets.get(recorded.userId);
          if (!trusted) throw new CommandError('Het dashboard kent deze beperking, maar mist vertrouwde gebruikersgegevens om veilig te herstellen. Controleer TikTok.', 409);
          target = trusted;
          name = recorded.name;
          recordedRestore = { userId: recorded.userId, action: axis };
        }
        displayName = identity(target.userId).displayName;
      }
      const before = JSON.stringify(feedback().entries);
      let result: { accepted: true };
      try {
        result = await direct.withModeration(async mod => {
          const perform = async (step: ModerationAction) => {
            if (!active()) throw new DirectTikTokError('inactive');
            const value = await auditedModeration(audit, {
              actor: { id: user.id, name: user.name.slice(0, 100) },
              target: { id: target.userId, name: name.slice(0, 100), ...(displayName ? { displayName } : {}) }, roomId,
              action: step, ...(step === 'mute' ? { duration } : {})
            }, () => mod.act(config.username, roomId, step, target, duration, active));
            if ((step === 'mute' || step === 'ban') && active()) {
              targets.delete(target.userId);
              targets.set(target.userId, { ...target });
              if (targets.size > 1000) targets.delete(targets.keys().next().value!);
            } else if (!restriction(target.userId, 'mute') && !restriction(target.userId, 'ban')) targets.delete(target.userId);
            return value;
          };
          if (action === 'mute-ban') {
            await perform('mute');
            acceptedMute = true;
            return perform('ban');
          }
          return perform(action);
        });
      } finally {
        const current = feedback();
        if (JSON.stringify(current.entries) !== before) changed?.(current);
      }
      reply(200, result);
    } catch (error) {
      const status = error instanceof CommandError ? error.status : error instanceof OperationBusyError ? 429
        : error instanceof DirectTikTokError ? ['permission', 'target-role'].includes(error.kind) ? 403 : 502 : 503;
      const reason = error instanceof CommandError || error instanceof OperationBusyError || error instanceof AuditOutcomeUnknownError
        ? error.message : error instanceof DirectTikTokError ? directErrorText(error) : 'Moderatie kon niet veilig worden afgerond. Er is geen automatische herhaling.';
      reply(status, { error: `${acceptedMute ? 'Demping is door de API geaccepteerd; blokkeren is niet bevestigd. ' : ''}${reason}`,
        ...(acceptedMute ? { partial: true, completed: ['mute'] } : {}) }, error);
    }
    return true;
  };
}
