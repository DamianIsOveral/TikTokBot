import { element, escapeHTML } from './dom.js';
import { automaticCategory } from './filters.js';
import { pending, state } from './model.js';
import type { Message } from './model.js';
import { renderPage } from './pages.js';
import { moderationDisabledReason } from '../shared/moderation-policy.js';
import {usernameColor} from '../shared/username-color.js';
import {moderationBadges, moderationEntries} from './moderation-feedback.js';
import {displayName, avatarHTML} from './user-identity.js';

export function actionButtons(message: Message): string {
  const mute = moderationDisabledReason(state, message, 'mute');
  const ban = moderationDisabledReason(state, message, 'ban');
  const reasons = [...new Set([mute, ban].filter(Boolean))];
  const duration = [0,5,30,60,300].includes(message.reviewDuration ?? 30) ? message.reviewDuration ?? 30 : 30;
  return `<div class="actions review-actions"><button class="mute review-quick-mute" data-action="mute" data-id="${message.id}" ${mute ? 'disabled' : ''}
    title="${escapeHTML(mute)}">Dempen${state.liveMode ? '' : ' · demo'}</button>
    <button class="review-secondary" data-action="ban" data-id="${message.id}" ${ban ? 'disabled' : ''} title="${escapeHTML(ban)}">Blokkeren${state.liveMode ? '' : ' · demo'}</button>
    <button class="review-secondary" data-action="mute-ban" data-id="${message.id}" ${mute || ban ? 'disabled' : ''} title="${escapeHTML(mute || ban || 'Eerst dempen met de gekozen demptijd, daarna blokkeren.')}">Dempen en blokkeren${state.liveMode ? '' : ' · demo'}</button>
    <button class="review-secondary" data-action="ignore" data-id="${message.id}">Negeren</button>
    <select class="review-duration" data-review-duration="${message.id}" aria-label="Demptijd voor ${escapeHTML(message.user)}">${[[30,'30 s'],[5,'5 s'],[60,'1 min'],[300,'5 min'],[0,'Deze LIVE']].map(([value,label])=>`<option value="${value}" ${duration===value?'selected':''}>${label}</option>`).join('')}</select>
    <button class="review-menu" data-menu="${message.id}" aria-label="Alle acties voor @${escapeHTML(message.user)}" aria-haspopup="menu" aria-controls="message-menu" aria-expanded="${state.menuMessageId===message.id}" title="Alle berichtacties">⋯</button>
    ${reasons.map(reason => `<small class="action-unavailable">${escapeHTML(reason)}</small>`).join('')}</div>`;
}

export function render(): void {
  const query = element<HTMLInputElement>('#search').value.toLowerCase();
  let rows = state.messages.filter(message => `${message.user} ${message.displayName || ''} ${message.text}`.toLowerCase().includes(query));
  if (element<HTMLSelectElement>('#sort').value === 'new') rows = rows.slice().reverse();
  element('#chat').innerHTML = rows.map(message => {
    const flagged = !message.resolved && (message.manualReview || automaticCategory(message, state.settings));
    return `<div data-message="${message.id}" class="row ${flagged ? 'flagged' : ''}"><time>${escapeHTML(message.time)}</time>
      <div class="avatar user-avatar">${avatarHTML(message)}</div><strong title="@${escapeHTML(message.user)}" class="user-color-${usernameColor(message.user)}">${escapeHTML(displayName(message))}${message.isBot?'<small class="bot-label">BOT</small>':''}${message.isModerator?'<small class="mod-label">MOD</small>':''}${flagged?'<small class="review-label" title="Gemarkeerd voor beoordeling" aria-label="Gemarkeerd voor beoordeling">!</small>':''}</strong>
      <p>${escapeHTML(message.text)}<span class="moderation-feedback" data-moderation-user="${escapeHTML(message.userId || '')}">${moderationBadges(message.userId)}</span></p><button class="review-message" data-menu="${message.id}"
      aria-label="Acties voor @${escapeHTML(message.user)}" aria-haspopup="menu" aria-controls="message-menu"
      aria-expanded="${state.menuMessageId === message.id}" title="Berichtacties">⋯</button></div>`;
  }).join('') || `<div class="empty">${state.liveMode && (!state.serverConnected || state.phase !== 'connected')
    ? 'Niet verbonden. Klik op Verbinden om de LIVE-chat te laden.' : 'Nog geen berichten.'}</div>`;
  const items = pending();
  element('#total').textContent = String(state.messages.length);
  element('#count').textContent = element('#badge').textContent = String(items.length);
  element('#reviews').innerHTML = items
    .filter(message => state.filter === 'Alle' || automaticCategory(message, state.settings) === state.filter)
    .reverse().map(message => `<div class="card"><div class="cardtop"><div class="avatar user-avatar">${avatarHTML(message)}</div>
      <div class="cardbody"><time>${escapeHTML(message.time)}</time><strong title="@${escapeHTML(message.user)}" class="user-color-${usernameColor(message.user)}">${escapeHTML(displayName(message))}${message.isModerator?'<small class="mod-label">MOD</small>':''}</strong>
      <p>${escapeHTML(message.text)}</p><span class="tag">${escapeHTML(automaticCategory(message, state.settings) || 'Handmatig')}</span></div></div>
      ${actionButtons(message)}</div>`).join('')
    || '<div class="empty">✓ Geen berichten om te beoordelen.</div>';
  const latest = moderationEntries().slice().sort((a,b)=>b.at.localeCompare(a.at))[0];
  const actions = {mute:'Dempen',unmute:'Dempen opheffen',ban:'Blokkeren',unban:'Deblokkeren'};
  element('#activity').textContent = latest ? `@${latest.name}: ${actions[latest.action]} · ${latest.status === 'accepted' ? 'door TikTok geaccepteerd' : 'uitkomst onbekend'} · ${new Date(latest.at).toLocaleTimeString('nl-NL')}`
    : state.activity[0] || 'Nog geen moderatieacties via dit dashboard.';
  if (state.page === 'Overzicht') renderPage(render);
}

let renderTimer: ReturnType<typeof setTimeout> | undefined;
export function scheduleRender(): void {
  if (renderTimer) return;
  renderTimer = setTimeout(() => { renderTimer = undefined; render(); }, 100);
}
