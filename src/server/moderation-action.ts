import type { AuditInput, AuditStore } from '../shared/moderation.ts';
import { DirectTikTokError, directErrorText } from './tiktok/direct-client.ts';

export class AuditOutcomeUnknownError extends Error {
  constructor() { super('De actie kan zijn uitgevoerd, maar de uitkomst kon niet in het log worden bevestigd. Controleer TikTok; herhaal de actie niet blind.'); }
}

export async function auditedModeration<T>(audit: AuditStore, input: AuditInput, perform: () => Promise<T>): Promise<T> {
  const entry = await audit.begin(input);
  let result: T;
  try { result = await perform(); }
  catch (error) {
    const uncertain = !(error instanceof DirectTikTokError) || ['network', 'response', 'empty'].includes(error.kind);
    try { await audit.finish(entry.id, uncertain ? 'uncertain' : 'rejected', directErrorText(error)); }
    catch { throw new AuditOutcomeUnknownError(); }
    throw error;
  }
  try { await audit.finish(entry.id, 'accepted'); }
  catch { throw new AuditOutcomeUnknownError(); }
  return result;
}
