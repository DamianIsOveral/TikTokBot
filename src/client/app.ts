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

function updateMode(live: boolean): void {
  state.liveMode = live;
  element<HTMLButtonElement>('#add').disabled = live;
  element<HTMLButtonElement>('#demo').disabled = !live;
  element('.demo span').textContent = live
    ? 'Livechat van de server. Laatste 500 berichten; dempen blijft een demoactie.'
    : 'Lokale voorbeeldberichten. Een eventuele serververbinding blijft actief.';
}

function updateConnection(data: StatusEvent | Snapshot): void {
  element('#live-status').textContent = data.text;
  state.phase = data.phase || state.phase;
  const connect = element<HTMLButtonElement>('#connect');
  connect.disabled = state.phase === 'connecting';
  connect.textContent = state.phase === 'connected' ? 'Livechat tonen' : 'Verbinden';
  element<HTMLButtonElement>('#stop').disabled = !['connecting', 'connected', 'error'].includes(state.phase);
}

function onEvent(data: ClientEvent): void {
  if (data.type === 'bot') {
    showBotStatus(data.text);
  } else if (data.type === 'transport') {
    element('#live-status').textContent = data.text;
    element<HTMLButtonElement>('#connect').disabled = element<HTMLButtonElement>('#stop').disabled = true;
  } else if (data.type === 'snapshot') {
    showBotStatus(data.botStatus || '');
    updateConnection(data);
    updateMode(data.mode === 'live');
    resetMessages();
    if (state.liveMode) {
      for (const message of data.messages) addMessage(message.user, message.text, displayTime(message.time));
    } else loadDemo();
    render();
  } else if (data.type === 'status') {
    updateConnection(data);
    if (data.phase === 'connecting') { showBotStatus(''); resetMessages(); updateMode(true); render(); }
  } else if (data.type === 'chat' && state.liveMode) {
    addMessage(data.user, data.text, displayTime(data.time));
    scheduleRender();
  }
}

function showBotStatus(text: string): void {
  const node = element('#bot-status');
  node.textContent = text;
  node.classList.toggle('hidden', !text);
}

const connection = createConnection(onEvent);
element('#demo').onclick = () => { updateMode(false); loadDemo(); render(); };
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
element('#tabs').addEventListener('click', event => {
  const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-filter]') : null;
  if (!button) return;
  state.filter = button.dataset.filter as Category | 'Alle';
  document.querySelectorAll('[data-filter]').forEach(node => node.classList.toggle('selected', node === button));
  render();
});
element('#reviews').addEventListener('click', event => {
  const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-action]') : null;
  const message = state.messages.find(item => item.id === Number(button?.dataset.id));
  if (!button || !message || message.resolved) return;
  const duration = button.parentElement?.querySelector('select')?.value || '5 minuten';
  message.resolved = true;
  const line = button.dataset.action === 'mute'
    ? `DEMO: @${message.user} gedempt voor ${duration}. Er is niets naar TikTok verzonden.`
    : `@${message.user}: bericht genegeerd in de demo.`;
  state.activity.unshift(line);
  if (state.activity.length > 100) state.activity.pop();
  toast(line);
  render();
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
  loadDemo();
  render();
  connection.subscribe();
  void connection.config().then(config => {
  state.username = config.username;
  element('#channel').textContent = `@${config.username}`;
  if (state.page === 'Instellingen') renderPage(render);
  }).catch(() => {});
}
