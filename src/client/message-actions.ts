import { state } from './model.js';
import { escapeHTML, toast } from './dom.js';
import { moderateMessage, refreshModerationAccess, restoreMessage } from './moderation.js';
import { confirmedRestriction, subscribeModerationFeedback } from './moderation-feedback.js';
import { moderationDisabledReason } from '../shared/moderation-policy.js';
import {displayName} from './user-identity.js';

export function createMessageActions(onChange: () => void) {
  const menu = document.createElement('div');
  menu.id = 'message-menu';
  menu.className = 'message-menu';
  menu.setAttribute('popover', 'auto');
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Berichtacties');
  document.body.append(menu);
  let busy = false;
  let view: 'main' | 'mute' | 'mute-ban' = 'main';
  let position = { x: 12, y: 12 };

  function close() {
    document.querySelector(`[data-menu="${state.menuMessageId}"]`)?.setAttribute('aria-expanded', 'false');
    state.menuMessageId = undefined;
    if (menu.matches(':popover-open')) menu.hidePopover();
  }
  menu.addEventListener('toggle', () => {
    if (!menu.matches(':popover-open')) {
      document.querySelector(`[data-menu="${state.menuMessageId}"]`)?.setAttribute('aria-expanded', 'false');
      state.menuMessageId = undefined;
    }
  });

  async function perform(action: 'mute' | 'ban' | 'mute-ban' | 'ignore', id: number, duration = 30) {
    const message = state.messages.find(item => item.id === id);
    if (!message || busy) return;
    if (action !== 'ignore') {
      const reason = action === 'mute-ban'
        ? moderationDisabledReason(state, message, 'mute') || moderationDisabledReason(state, message, 'ban')
        : moderationDisabledReason(state, message, action);
      if (reason) { toast(reason); return; }
      if (state.liveMode && (action === 'ban' || action === 'mute-ban') && !window.confirm(action === 'mute-ban'
        ? `@${message.user} eerst dempen ${duration === 0 ? 'voor deze LIVE' : `voor ${duration} seconden`} en daarna blokkeren? Dit zijn twee afzonderlijke acties.`
        : `@${message.user} blokkeren? Je kunt dit terugdraaien via dit menu of onder Moderatie.`)) return;
    }
    close();
    busy = true;
    try {
      if (state.liveMode && action !== 'ignore') {
        if (await moderateMessage(action, id, duration)) message.resolved = true;
      } else {
        message.resolved = true;
        const line = action === 'ignore' ? `@${message.user}: bericht lokaal genegeerd.`
          : `DEMO: @${message.user} ${action === 'ban' ? 'geblokkeerd' : `gedempt voor ${duration === 0 ? 'de gehele LIVE' : `${duration} seconden`}${action === 'mute-ban' ? ' en geblokkeerd' : ''}`}. Er is niets naar TikTok verzonden.`;
        state.activity.unshift(line);
        state.activity.length = Math.min(100, state.activity.length);
        toast(line);
      }
    } finally { busy = false; onChange(); }
  }

  async function restore(action: 'unmute' | 'unban', id: number) {
    const message = state.messages.find(item => item.id === id);
    if (!message || busy) return;
    const axis = action === 'unmute' ? 'mute' : 'ban';
    if (!confirmedRestriction(message.userId, axis)) { paint(); toast('Geen bevestigde actieve beperking via dit dashboard.'); return; }
    const reason = moderationDisabledReason(state, message, axis);
    if (reason) { toast(reason); return; }
    close();
    busy = true;
    try { await restoreMessage(action, message.userId!); }
    catch (error) { toast(error instanceof Error ? error.message : 'Herstellen mislukt.'); }
    finally { busy = false; onChange(); }
  }

  function paint() {
    const message = state.messages.find(item => item.id === state.menuMessageId);
    if (!message) { close(); return; }
    const focusedAction = menu.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.menuAction : undefined;
    const muteReason = moderationDisabledReason(state, message, 'mute');
    const banReason = moderationDisabledReason(state, message, 'ban');
    const muted = confirmedRestriction(message.userId, 'mute');
    const blocked = confirmedRestriction(message.userId, 'ban');
    if (muted || (blocked && view === 'mute-ban')) view = 'main';
    const button = (action: string, label: string, reason = '') => `<button role="menuitem" data-menu-action="${action}"
      ${reason ? 'disabled' : ''} title="${escapeHTML(reason)}">${label}</button>`;
    const reasons = [...new Set([muteReason, banReason].filter(Boolean))];
    menu.innerHTML = `<strong>${escapeHTML(displayName(message))}</strong><small>@${escapeHTML(message.user)}</small>${!state.liveMode ? '<small>Lokale test · geen TikTok-acties</small>' : ''}
      ${view !== 'main'
        ? button('back', '← Terug') + `<span>${view === 'mute-ban' ? 'Eerst dempen, daarna blokkeren' : 'Demptijd'}</span>` + [[5, '5 seconden'], [30, '30 seconden'], [60, '1 minuut'], [300, '5 minuten'], [0, 'Gehele LIVE']]
          .map(([duration, label]) => button(`${view}:${duration}`, String(label), muteReason || (view === 'mute-ban' ? banReason : ''))).join('')
        : button('review', 'Markeren voor beoordeling') + button(muted ? 'unmute' : 'mute-menu', muted ? 'Dempen opheffen' : 'Dempen ›', muteReason)
          + button(blocked ? 'unban' : 'ban', blocked ? 'Deblokkeren' : 'Blokkeren', banReason)
          + (!muted && !blocked ? button('mute-ban-menu', 'Dempen en blokkeren ›', muteReason || banReason) : '')
          + button('ignore', 'Bericht lokaal negeren')}
      ${reasons.map(reason => `<small role="status">${escapeHTML(reason)}</small>`).join('')}
      ${state.liveMode ? button('refresh', 'Rechten opnieuw controleren') : ''}`;
    const box = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(position.x, innerWidth - box.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(position.y, innerHeight - box.height - 8))}px`;
    if (focusedAction) [...menu.querySelectorAll<HTMLButtonElement>('button')].find(button => button.dataset.menuAction === focusedAction)?.focus();
  }

  async function open(id: number, point: { x: number; y: number }) {
    close();
    state.menuMessageId = id;
    view = 'main'; position = point;
    menu.showPopover(); paint();
    document.querySelector(`[data-menu="${id}"]`)?.setAttribute('aria-expanded', 'true');
    menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    await refreshModerationAccess();
    if (menu.matches(':popover-open') && state.menuMessageId === id) { paint(); onChange(); }
  }
  menu.addEventListener('click', event => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-menu-action]') : null;
    if (!button || button.disabled) return;
    const id = state.menuMessageId;
    const message = state.messages.find(item => item.id === id);
    if (!message) { close(); return; }
    const action = button.dataset.menuAction!;
    if (action === 'review') {
      message.manualReview = true; message.resolved = false; state.filter = 'Alle';
      document.querySelectorAll<HTMLElement>('[data-filter]').forEach(node => node.classList.toggle('selected', node.dataset.filter === 'Alle'));
      close(); onChange();
    } else if (action === 'mute-menu' || action === 'mute-ban-menu' || action === 'back') {
      view = action === 'back' ? 'main' : action === 'mute-menu' ? 'mute' : 'mute-ban'; paint();
      menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    } else if (action === 'refresh') {
      button.disabled = true;
      void refreshModerationAccess().then(() => { if (menu.matches(':popover-open')) paint(); onChange(); });
    } else if (action === 'unmute' || action === 'unban') void restore(action, message.id);
    else if (action === 'ban' || action === 'ignore') void perform(action, message.id);
    else if (action.startsWith('mute:')) void perform('mute', message.id, Number(action.split(':')[1]));
    else if (action.startsWith('mute-ban:')) void perform('mute-ban', message.id, Number(action.split(':')[1]));
  });
  subscribeModerationFeedback(() => { if (menu.matches(':popover-open')) paint(); }, () => menu.isConnected);
  menu.addEventListener('keydown', event => {
    const buttons = [...menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') {
      event.preventDefault(); const id = state.menuMessageId; close();
      document.querySelector<HTMLButtonElement>(`[data-menu="${id}"]`)?.focus();
    }
    else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
        : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    }
  });
  return { open, close, perform };
}
