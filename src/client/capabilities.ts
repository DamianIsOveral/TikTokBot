import type { ChatCapabilities } from '../shared/capabilities.js';
import { element } from './dom.js';
import { state } from './model.js';
import { updateCommandAccess } from './commands.js';

export function showChatAccess(value: ChatCapabilities): void {
  state.capabilities = value;
  const banner = element('#chat-status');
  banner.textContent = value.chat ? '' : value.reason;
  banner.classList.toggle('hidden', value.chat);
  updateCommandAccess(value);
  const summary = document.querySelector<HTMLElement>('[data-chat-summary]');
  if (summary) summary.textContent = describe(value);
}

function describe(value: ChatCapabilities): string {
  const checked = value.checkedAt ? new Date(value.checkedAt).toLocaleTimeString('nl-NL') : 'nog niet';
  return `${value.reason} Laatst gecontroleerd: ${checked}.`;
}

export function mountChatAccess(root: HTMLElement): void {
  const section = document.createElement('section');
  section.innerHTML = `<h3>Botverbinding</h3><p data-chat-summary role="status"></p>
    <button type="button">Rechten opnieuw controleren</button>`;
  root.append(section);
  const summary = section.querySelector<HTMLElement>('[data-chat-summary]')!;
  summary.textContent = state.capabilities ? describe(state.capabilities) : 'Botverbinding wordt gecontroleerd.';
  const button = section.querySelector<HTMLButtonElement>('button')!;
  button.onclick = async () => {
    button.disabled = true;
    try {
      const response = await fetch('/api/capabilities', { method: 'POST',
        headers: { 'X-Requested-With': 'faynominaal' } });
      if (!response.ok) throw new Error();
      showChatAccess(await response.json() as ChatCapabilities);
    } catch { summary.textContent = 'Rechten ophalen mislukt. Controleer je serververbinding.'; }
    finally { button.disabled = false; }
  };
}
