import {escapeHTML} from './dom.js';
import {safeAvatarUrl} from '../shared/user-identity.js';

interface Identity { user: string; displayName?: string; avatarUrl?: string }
const failed = new Set<string>();
let listening = false;

export function displayName(user: Identity): string { return user.displayName || user.user; }

export function avatarHTML(user: Identity): string {
  const letter = escapeHTML(Array.from(displayName(user))[0]?.toUpperCase() || '?');
  const url = document.body.classList.contains('user-avatars') ? safeAvatarUrl(user.avatarUrl) : undefined;
  return letter + (url && !failed.has(url) ? `<img class="user-picture" src="${escapeHTML(url)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : '');
}

export function initializeUserAvatars(): void {
  if (listening) return;
  listening = true;
  document.addEventListener('error', event => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement) || !image.classList.contains('user-picture')) return;
    failed.add(image.src);
    if (failed.size > 500) failed.delete(failed.values().next().value!);
    image.remove();
  }, true);
}
