import {escapeHTML} from './dom.js';
import {state} from './model.js';

export function moderationIdentity(userId: string, fallback: string, displayName?: string, username?: string): string {
  const message = state.messages.findLast(item => item.userId === userId);
  const canonical = username || message?.user;
  const label = displayName || message?.displayName || fallback || canonical || userId;
  return `<strong title="${escapeHTML(canonical ? `@${canonical}` : userId)}">${escapeHTML(label)}</strong>`
    + (canonical ? `<small>@${escapeHTML(canonical)}</small>` : '');
}
