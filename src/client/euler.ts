import type { EulerCapabilities } from '../shared/capabilities.js';
import { element } from './dom.js';
import { state } from './model.js';
import { updateCommandAccess } from './commands.js';

export function showEulerAccess(value: EulerCapabilities): void {
  state.capabilities = value;
  const banner = element('#euler-status');
  banner.textContent = value.chat ? '' : value.reason;
  banner.classList.toggle('hidden', value.chat);
  updateCommandAccess(value);
  const summary = document.querySelector<HTMLElement>('[data-euler-summary]');
  if (summary) summary.textContent = describe(value);
}

function describe(value: EulerCapabilities): string {
  const checked = value.checkedAt ? new Date(value.checkedAt).toLocaleTimeString('nl-NL') : 'nog niet';
  return `${value.reason} Laatst gecontroleerd: ${checked}.`;
}

export function mountEulerAccess(root: HTMLElement): void {
  const section = document.createElement('section');
  section.innerHTML = `<h3>Euler-toegang</h3><p data-euler-summary role="status"></p>
    <button type="button" data-euler-refresh>Rechten opnieuw controleren</button>`;
  root.append(section);
  const summary = section.querySelector<HTMLElement>('[data-euler-summary]')!;
  summary.textContent = state.capabilities ? describe(state.capabilities) : 'Euler-rechten worden gecontroleerd.';
  const button = section.querySelector<HTMLButtonElement>('button')!;
  button.onclick = async () => {
    button.disabled = true;
    try {
      const response = await fetch('/api/capabilities', { method: 'POST',
        headers: { 'X-Requested-With': 'faynominaal' } });
      if (!response.ok) throw new Error();
      showEulerAccess(await response.json() as EulerCapabilities);
    } catch { summary.textContent = 'Rechten ophalen mislukt. Controleer je serververbinding.'; }
    finally { button.disabled = false; }
  };
}
