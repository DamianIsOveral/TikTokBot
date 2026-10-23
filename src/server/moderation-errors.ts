import type { IncomingMessage, ServerResponse } from 'node:http';
import { allowMutation } from './http/security.ts';
import { readJson } from './http/json.ts';
import { DirectTikTokError } from './tiktok/direct-client.ts';
import { CommandError } from './command-validation.ts';
import { OperationBusyError } from './operation-queue.ts';
import { AuditOutcomeUnknownError } from './moderation-action.ts';

const operations = ['mute', 'unmute', 'ban', 'unban', 'mute-ban', 'access', 'muted-list', 'blocked-list', 'audit'] as const;
export function moderationReference(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
export type ModerationOperation = typeof operations[number];
export function moderationOperation(value: unknown): ModerationOperation | undefined {
  return typeof value === 'string' && operations.includes(value as ModerationOperation) ? value as ModerationOperation : undefined;
}
function log(value: Record<string, unknown>): void {
  console.error(JSON.stringify({ timestamp: new Date().toISOString(), event: 'moderation-request-failed', ...value }));
}
export function logModerationFailure(reference: string, operation: ModerationOperation | undefined, status: number,
  error?: unknown, partial = false): void {
  const kind = error instanceof DirectTikTokError ? error.kind : error instanceof CommandError ? 'validation'
    : error instanceof OperationBusyError ? 'busy' : error instanceof AuditOutcomeUnknownError ? 'audit-outcome-unknown'
      : error === undefined ? 'http' : 'unknown';
  const safeNumber = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined;
  log({ source: 'server', reference, operation, status, kind,
    ...(error instanceof DirectTikTokError ? { upstreamStatus: safeNumber(error.status), apiCode: safeNumber(error.apiCode) } : {}),
    ...(partial ? { partial: true, completed: ['mute'] } : {}) });
}
export function createModerationErrorReports() {
  let windowStart = 0;
  let count = 0;
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!allowMutation(req, res)) return;
    const now = Date.now();
    if (now - windowStart >= 60_000) { windowStart = now; count = 0; }
    if (++count > 20) { req.resume(); res.writeHead(429).end(); return; }
    try {
      const body = await readJson(req);
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
      const report = body as Record<string, unknown>;
      const fields = ['reference', 'operation', 'kind', 'status', 'contentType', 'redirected'];
      if (Object.keys(report).length !== fields.length || Object.keys(report).some(key => !fields.includes(key))
        || !moderationReference(report.reference)
        || !moderationOperation(report.operation) || typeof report.kind !== 'string' || !['network', 'http', 'invalid-response'].includes(report.kind)
        || typeof report.status !== 'number' || !Number.isInteger(report.status) || report.status < 0 || report.status > 599
        || typeof report.contentType !== 'string' || !['json', 'html', 'other', 'missing'].includes(report.contentType) || typeof report.redirected !== 'boolean') throw new Error();
      log({ source: 'dashboard', ...report });
      res.writeHead(204).end();
    } catch { res.writeHead(400).end(JSON.stringify({ error: 'Ongeldig moderatiefoutrapport.' })); }
  };
}
