import type { ClientEvent, StatusEvent, Snapshot } from '../shared/events.js';
import { element, displayTime, toast } from './dom.js';
import { addSample, loadDemo } from './demo.js';
import { addMessage, resetMessages, state } from './model.js';
import type { Page } from './model.js';
import type { Category } from './filters.js';
import { createConnection } from './connection.js';
import { render, scheduleRender } from './render.js';
import { renderPage } from './pages.js';
import { requireUser } from './auth.js';
import { showChatAccess } from './capabilities.js';
import { refreshModerationAccess } from './moderation.js';
import { createMessageActions } from './message-actions.js';

function updateMode(live: boolean): void {
  messageActions.close();
  state.liveMode = live;
  element<HTMLButtonElement>('#add').disabled = live;
  element<HTMLButtonElement>('#demo').disabled = !live;
  element('.demo span').textContent = live
    ? state.phase === 'connected' ? 'LIVE-chat van de server. De bot blijft werken als je dit dashboard sluit.'
      : 'Niet verbonden met TikTok LIVE. Er worden geen LIVE-berichten getoond.'
    : 'LOKALE TEST · Voorbeeldinhoud; deze knoppen voeren geen TikTok-acties uit.';
  element('#demo').textContent = live ? 'Lokale test' : 'Test afsluiten';
  element<HTMLButtonElement>('#demo').disabled = false;
  const badge = element('#connection-badge');
  badge.textContent = !live ? 'LOKALE TEST' : !state.serverConnected ? 'SERVER NIET BEREIKBAAR'
    : state.phase === 'connected' ? 'LIVE VERBONDEN' : state.phase === 'connecting' ? 'VERBINDEN…' : 'NIET VERBONDEN';
  badge.dataset.connected = String(live && state.serverConnected && state.phase === 'connected');
  if (state.page === 'Moderatie') renderPage(render);
}

function updateConnection(data: StatusEvent | Snapshot): void {
  element('#live-status').textContent = data.text;
  state.phase = data.phase || state.phase;
  const connect = element<HTMLButtonElement>('#connect');
  connect.disabled = state.phase === 'connecting';
  connect.textContent = state.phase === 'connected' ? 'Livechat tonen' : 'Verbinden';
  element<HTMLButtonElement>('#stop').disabled = !['connecting', 'connected', 'error', 'disconnected'].includes(state.phase);
}

function onEvent(data: ClientEvent): void {
  if (data.type === 'capabilities') {
    showChatAccess(data.value);
    render();
    if (state.phase === 'connected' && !state.moderation?.connected) void refreshModerationAccess().then(render);
  } else if (data.type === 'bot') {
    showBotStatus(data.text);
  } else if (data.type === 'transport') {
    state.serverConnected = false;
    element('#live-status').textContent = data.text;
    element<HTMLButtonElement>('#connect').disabled = element<HTMLButtonElement>('#stop').disabled = true;
    if (state.liveMode) resetMessages();
    updateMode(state.liveMode);
    render();
  } else if (data.type === 'snapshot') {
    state.serverConnected = true;
    if (data.capabilities) showChatAccess(data.capabilities);
    showBotStatus(data.botStatus || '');
    updateConnection(data);
    updateMode(data.mode === 'live');
    resetMessages();
    if (state.liveMode && state.phase === 'connected') {
      for (const message of data.messages) addMessage(message.user, message.text, displayTime(message.time), message);
    } else if (!state.liveMode) loadDemo();
    render();
    if (state.phase === 'connected') void refreshModerationAccess().then(render);
  } else if (data.type === 'status') {
    state.moderation = undefined;
    updateConnection(data);
    if (data.phase === 'connecting') { showBotStatus(''); resetMessages(); updateMode(true); render(); }
    if (data.phase !== 'connecting') {
      if (state.liveMode && data.phase !== 'connected') resetMessages();
      updateMode(state.liveMode);
      render();
    }
    if (data.phase === 'connected') void refreshModerationAccess().then(render);
  } else if (data.type === 'chat' && state.liveMode) {
    addMessage(data.user, data.text, displayTime(data.time), data);
    scheduleRender();
  }
}

function showBotStatus(text: string): void {
  const node = element('#bot-status');
  node.textContent = text;
  node.classList.toggle('hidden', !text);
}

const connection = createConnection(onEvent);
const messageActions = createMessageActions(render);
element('#demo').onclick = () => {
  if (state.liveMode) { updateMode(false); loadDemo(); render(); }
  else { resetMessages(); updateMode(true); connection.subscribe(); render(); }
};
element('#connect').onclick = async () => {
  element<HTMLButtonElement>('#connect').disabled = true;
  try { await connection.connect(); }
  catch { toast('Verbinden mislukt. Controleer de serververbinding.'); }
  finally { element<HTMLButtonElement>('#connect').disabled = state.phase === 'connecting'; }
};
element('#stop').onclick = async () => {
  try { await connection.stop(); }
  catch { toast('Stoppen mislukt. Controleer de serververbinding.'); }
};
element('#add').onclick = () => { addSample(); render(); };
element('#search').addEventListener('input', render);
element('#sort').addEventListener('change', render);
element('#chat').addEventListener('click', event => {
  const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-menu]') : null;
  if (!button) return;
  const box = button.getBoundingClientRect();
  void messageActions.open(Number(button.dataset.menu), { x:box.right, y:box.top });
});
element('#chat').addEventListener('contextmenu', event => {
  const row = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-message]') : null;
  if (!row) return;
  event.preventDefault();
  void messageActions.open(Number(row.dataset.message), { x:event.clientX, y:event.clientY });
});
element('#tabs').addEventListener('click', event => {
  const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-filter]') : null;
  if (!button) return;
  state.filter = button.dataset.filter as Category | 'Alle';
  document.querySelectorAll('[data-filter]').forEach(node => node.classList.toggle('selected', node === button));
  render();
});
element('#reviews').addEventListener('click', async event => {
  const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-action]') : null;
  const message = state.messages.find(item => item.id === Number(button?.dataset.id));
  if (!button || !message || message.resolved) return;
  const duration = Number(button.parentElement?.querySelector('select')?.value || 30);
  const action = button.dataset.action;
  if (action !== 'mute' && action !== 'ban' && action !== 'ignore') return;
  button.disabled = true;
  await messageActions.perform(action, message.id, duration);
});
document.querySelectorAll<HTMLButtonElement>('[data-page]').forEach(button => {
  button.onclick = () => {
    state.page = button.dataset.page as Page;
    document.querySelectorAll('[data-page]').forEach(node => node.classList.toggle('active', node === button));
    element('#chatpage').classList.toggle('hidden', state.page !== 'Livechat');
    element('#otherpage').classList.toggle('hidden', state.page === 'Livechat');
    if (state.page !== 'Livechat') renderPage(render);
  };
});

if (await requireUser()) {
  updateMode(true);
  render();
  connection.subscribe();
  void connection.config().then(config => {
  state.username = config.username;
  element('#channel').textContent = `@${config.username}`;
  if (state.page === 'Instellingen') renderPage(render);
  }).catch(() => {});
}
