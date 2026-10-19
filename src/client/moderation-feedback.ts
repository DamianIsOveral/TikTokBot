import type { ModerationFeedbackEntry, ModerationFeedbackSnapshot } from '../shared/moderation-feedback.js';
import { escapeHTML } from './dom.js';
import { state } from './model.js';

let current: ModerationFeedbackSnapshot | undefined;
let receivedAt = 0;
let generation = 0;
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<{ changed: () => void; connected: () => boolean }>();
const names = { mute: 'Dempen', unmute: 'Dempen opheffen', ban: 'Blokkeren', unban: 'Deblokkeren' };

export function moderationNow(): number {
  return current ? current.serverNow + performance.now() - receivedAt : Date.now();
}

export function moderationEntries(): ModerationFeedbackEntry[] {
  return state.liveMode && state.serverConnected && state.phase === 'connected' ? current?.entries || [] : [];
}

function notify(): void {
  for (const listener of listeners) {
    if (listener.connected()) listener.changed();
    else listeners.delete(listener);
  }
}

export function moderationGeneration(): number { return generation; }

export function applyModerationFeedback(value: ModerationFeedbackSnapshot | undefined, expectedGeneration = generation): void {
  if (expectedGeneration !== generation) return;
  if (value && (!Array.isArray(value.entries) || !Number.isFinite(value.serverNow))) return;
  if (value && current && value.serverNow < current.serverNow) return;
  if (!value || (current && value.roomId !== current.roomId)) generation++;
  current = value;
  receivedAt = performance.now();
  notify();
}

export function subscribeModerationFeedback(changed: () => void, connected: () => boolean): () => void {
  const listener = { changed, connected };
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function activeDashboardMutes(): ModerationFeedbackEntry[] {
  const now = moderationNow();
  return moderationEntries().filter(entry => entry.action === 'mute' && entry.status === 'accepted'
    && (entry.expiresAt === undefined || entry.expiresAt > now));
}

export function confirmedRestriction(userId: string | undefined, action: 'mute' | 'ban'): boolean {
  return !!userId && moderationEntries().some(entry => entry.userId === userId && entry.action === action
    && entry.status === 'accepted' && (action === 'ban' || entry.expiresAt === undefined || entry.expiresAt > moderationNow()));
}

function label(entry: ModerationFeedbackEntry): { text: string; active: boolean; uncertain: boolean } {
  if (entry.status === 'uncertain') return { text: `${names[entry.action]} · uitkomst onbekend`, active: false, uncertain: true };
  if (entry.action === 'mute') {
    if (entry.expiresAt === undefined) return { text: 'Gedempt · deze LIVE', active: true, uncertain: false };
    const seconds = Math.max(0, Math.ceil((entry.expiresAt - moderationNow()) / 1000));
    return { text: seconds ? `Gedempt · nog circa ${seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`}`
      : 'Verwachte demptijd verstreken', active: seconds > 0, uncertain: false };
  }
  return { text: entry.action === 'ban' ? 'Geblokkeerd' : entry.action === 'unmute' ? 'Demping opgeheven' : 'Blokkering opgeheven',
    active: entry.action === 'ban', uncertain: false };
}

export function moderationBadges(userId: string | undefined, axis?: 'mute'): string {
  if (!userId) return '';
  return moderationEntries().filter(entry => entry.userId === userId && (!axis || ['mute', 'unmute'].includes(entry.action)))
    .map(entry => {
      const value = label(entry);
      const detail = value.uncertain ? 'De uitkomst is niet bevestigd. Controleer TikTok voordat je de actie herhaalt.'
        : 'Via dit dashboard door TikTok geaccepteerd. De resterende tijd is een schatting; acties buiten dit dashboard worden niet gevolgd.';
      return `<span class="moderation-feedback-badge" data-active="${value.active}" data-uncertain="${value.uncertain}" title="${escapeHTML(detail)}">${value.active ? '⊘' : value.uncertain ? '?' : '✓'} ${escapeHTML(value.text)}</span>`;
    }).join('');
}

function refreshBadges(): void {
  document.querySelectorAll<HTMLElement>('[data-moderation-user]').forEach(node => {
    const html = moderationBadges(node.dataset.moderationUser, node.dataset.moderationAxis === 'mute' ? 'mute' : undefined);
    if (node.innerHTML !== html) node.innerHTML = html;
  });
}

export function initializeModerationFeedback(): void {
  clearInterval(timer);
  timer = setInterval(() => {
    if (document.hidden || !['Livechat', 'Moderatie'].includes(state.page)) return;
    refreshBadges();
    notify();
  }, 1000);
}
