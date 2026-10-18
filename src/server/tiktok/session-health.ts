import type {ChatCapabilities} from '../../shared/capabilities.ts';
import {DirectTikTokError} from './direct-client.ts';

export function sessionFailure(error:unknown):NonNullable<ChatCapabilities['session']>['state'] {
  if(!(error instanceof DirectTikTokError))return 'unavailable';
  if(error.kind==='challenge')return 'challenged';
  if(error.status===429)return 'rate-limited';
  if(error.kind==='csrf')return 'stale';
  if(error.kind==='identity'||error.status===401||error.status===403)return 'invalid';
  if(error.kind==='session'||error.kind==='signing-context')return 'stale';
  return 'unavailable';
}
export function needsManualSessionCheck(error:unknown):boolean {
  return ['stale','challenged','rate-limited','invalid'].includes(sessionFailure(error));
}
