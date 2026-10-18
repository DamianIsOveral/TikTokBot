import { element, escapeHTML } from './dom.js';
import { automaticCategory } from './filters.js';
import { pending, state } from './model.js';
import type { Message } from './model.js';
import { renderPage } from './pages.js';
import { moderationDisabledReason } from '../shared/moderation-policy.js';

function avatar(message: Message): string { return escapeHTML(message.user[0]?.toUpperCase() || '?'); }
function actionButtons(message: Message): string {
  const mute = moderationDisabledReason(state, message, 'mute');
  const ban = moderationDisabledReason(state, message, 'ban');
  const reasons = [...new Set([mute, ban].filter(Boolean))];
  return `<div class="actions"><button class="mute" data-action="mute" data-id="${message.id}" ${mute ? 'disabled' : ''}
    title="${escapeHTML(mute)}">Dempen${state.liveMode ? '' : ' · demo'}</button>
    <button data-action="ban" data-id="${message.id}" ${ban ? 'disabled' : ''} title="${escapeHTML(ban)}">Blokkeren${state.liveMode ? '' : ' · demo'}</button>
    <button data-action="ignore" data-id="${message.id}">Negeren</button>
    <select aria-label="Demptijd voor ${escapeHTML(message.user)}"><option value="30">30 seconden</option><option value="5">5 seconden</option>
    <option value="60">1 minuut</option><option value="300">5 minuten</option><option value="0">Gehele LIVE</option></select>
    ${reasons.map(reason => `<small class="action-unavailable">${escapeHTML(reason)}</small>`).join('')}</div>`;
}

export function render(): void {
  const query = element<HTMLInputElement>('#search').value.toLowerCase();
  let rows = state.messages.filter(message => `${message.user} ${message.text}`.toLowerCase().includes(query));
  if (element<HTMLSelectElement>('#sort').value === 'new') rows = rows.slice().reverse();
  element('#chat').innerHTML = rows.map(message => {
    const flagged = !message.resolved && (message.manualReview || automaticCategory(message, state.settings));
    return `<div data-message="${message.id}" class="row ${flagged ? 'flagged' : ''}"><time>${escapeHTML(message.time)}</time>
      <div class="avatar">${avatar(message)}</div><strong>${escapeHTML(message.user)}${message.isBot?'<small class="bot-label">BOT</small>':''}</strong>
      <p>${escapeHTML(message.text)}</p><button class="review-message" data-menu="${message.id}"
      aria-label="Acties voor @${escapeHTML(message.user)}" aria-haspopup="menu" aria-controls="message-menu"
      aria-expanded="${state.menuMessageId === message.id}" title="Berichtacties">⋯</button></div>`;
  }).join('') || `<div class="empty">${state.liveMode && (!state.serverConnected || state.phase !== 'connected')
    ? 'Niet verbonden. Klik op Verbinden om de LIVE-chat te laden.' : 'Nog geen berichten.'}</div>`;
  const items = pending();
  element('#total').textContent = String(state.messages.length);
  element('#count').textContent = element('#badge').textContent = String(items.length);
  element('#reviews').innerHTML = items
    .filter(message => state.filter === 'Alle' || automaticCategory(message, state.settings) === state.filter)
    .reverse().map(message => `<div class="card"><div class="cardtop"><div class="avatar">${avatar(message)}</div>
      <div class="cardbody"><time>${escapeHTML(message.time)}</time><strong>@${escapeHTML(message.user)}</strong>
      <p>${escapeHTML(message.text)}</p><span class="tag">${escapeHTML(automaticCategory(message, state.settings) || 'Handmatig')}</span></div></div>
      ${actionButtons(message)}</div>`).join('')
    || '<div class="empty">✓ Geen berichten om te beoordelen.</div>';
  element('#activity').textContent = state.activity[0] || 'Nog geen lokale acties.';
  if (state.page === 'Overzicht') renderPage(render);
}

let renderTimer: ReturnType<typeof setTimeout> | undefined;
export function scheduleRender(): void {
  if (renderTimer) return;
  renderTimer = setTimeout(() => { renderTimer = undefined; render(); }, 100);
}
