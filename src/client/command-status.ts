import type { CommandStatus } from '../shared/command-status.js';
import { state } from './model.js';

let disposePrevious: (() => void) | undefined;

export function initializeCommandStatus(): () => void {
  disposePrevious?.();
  const root = document.querySelector<HTMLElement>('#command-status');
  if (!root) return () => {};
  const summary = document.createElement('strong');
  const triggers = document.createElement('span');
  const details = document.createElement('details');
  const label = document.createElement('summary');
  label.textContent = 'Limieten';
  const hint = document.createElement('small');
  details.append(label, hint);
  root.replaceChildren(summary, triggers, details);
  hint.textContent = 'Per kijker geldt ook 30s wachttijd. Antwoorden met meerdere berichten gebruiken meer budget.';
  let value: CommandStatus | undefined;
  let receivedAt = 0;
  let lastPoll = -Infinity;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let request: AbortController | undefined;
  let disposed = false;
  let leaving = false;
  let error = false;
  const active = () => !disposed && !leaving && !document.hidden && state.page === 'Livechat' && state.liveMode;
  const seconds = (until: number, at: number) => Math.max(0, Math.ceil((until - at) / 1000));
  const duration = (remaining: number) => remaining >= 60
    ? `${Math.floor(remaining / 60)}m ${remaining % 60}s` : `${remaining}s`;
  function render(): void {
    const at = value ? value.serverNow + performance.now() - receivedAt : 0;
    root!.dataset.state = !state.liveMode ? 'demo' : error ? 'unavailable' : value?.state || 'loading';
    if (!state.liveMode) summary.textContent = 'Commands · lokale test';
    else if (error) summary.textContent = 'Commandstatus niet bereikbaar';
    else if (!value) summary.textContent = 'Commandstatus laden…';
    else if (value.state === 'disabled') summary.textContent = 'Commands · bot uitgeschakeld';
    else if (value.state === 'disconnected') summary.textContent = 'Commands · LIVE niet verbonden';
    else if (value.state === 'session-unavailable') summary.textContent = 'Commands · verzendsessie niet beschikbaar';
    else if (value.busy) summary.textContent = 'Commands · antwoord wordt verstuurd';
    else if (value.state === 'ready') summary.textContent = 'Commands · globale limiet vrij';
    else {
      const remaining = seconds(value.nextReadyAt!, at);
      summary.textContent = remaining ? `Commands · globale wachttijd ${duration(remaining)}` : 'Commands · beschikbaarheid controleren…';
    }
    const cooldowns = !error && state.liveMode && value
      ? value.triggerCooldowns.filter(item => item.nextReadyAt > at)
        .map(item => `${item.trigger} ${duration(seconds(item.nextReadyAt, at))}`) : [];
    triggers.textContent = cooldowns.length ? `Commandwachttijd: ${cooldowns.join(' · ')}` : '';
    triggers.hidden = !cooldowns.length;
    details.hidden = !state.liveMode || error || !value;
    if (value && !error && state.liveMode) hint.textContent = `Budget: ${value.minute.remaining}/${value.minute.limit} per minuut, `
      + `${value.hour.remaining}/${value.hour.limit} per uur. Per kijker ook ${value.userCooldownSeconds}s wachttijd; lange antwoorden gebruiken meer budget.`;
  }
  async function poll(): Promise<void> {
    const controller = new AbortController();
    request = controller;
    lastPoll = performance.now();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch('/api/command-status', { signal: controller.signal, cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) throw new Error('Status niet beschikbaar');
      const result = await response.json() as CommandStatus;
      if (request !== controller || !active()) return;
      value = result;
      receivedAt = performance.now();
      error = false;
    } catch {
      if (request === controller && active()) error = true;
    } finally {
      clearTimeout(timeout);
      if (request === controller) {
        request = undefined;
        render();
      }
    }
  }
  function tick(): void {
    clearTimeout(timer);
    if (!active()) { request?.abort(); request = undefined; render(); return; }
    if (!request && performance.now() - lastPoll >= 5000) void poll();
    render();
    timer = setTimeout(tick, 1000);
  }
  function resume(): void {
    if (active()) lastPoll = -Infinity;
    tick();
  }
  const observer = new MutationObserver(resume);
  const chatPage = document.querySelector('#chatpage');
  const badge = document.querySelector('#connection-badge');
  if (chatPage) observer.observe(chatPage, { attributes: true, attributeFilter: ['class'] });
  if (badge) observer.observe(badge, { attributes: true, attributeFilter: ['data-connected'] });
  const pageHide = () => { leaving = true; tick(); };
  const pageShow = () => { leaving = false; resume(); };
  document.addEventListener('visibilitychange', resume);
  window.addEventListener('pagehide', pageHide);
  window.addEventListener('pageshow', pageShow);
  const dispose = () => {
    disposed = true;
    clearTimeout(timer);
    request?.abort(); request = undefined;
    observer.disconnect();
    document.removeEventListener('visibilitychange', resume);
    window.removeEventListener('pagehide', pageHide);
    window.removeEventListener('pageshow', pageShow);
  };
  disposePrevious = dispose;
  tick();
  return dispose;
}
