import type { CommandDefinition, CommandSettings } from '../shared/commands.js';
import { element, escapeHTML } from './dom.js';
import type { ChatCapabilities } from '../shared/capabilities.js';
import { commandPolicy, planResponses } from '../shared/command-policy.js';

let currentAccess: ((value: ChatCapabilities) => void) | undefined;
export function updateCommandAccess(value: ChatCapabilities): void { currentAccess?.(value); }

export function mountCommands(): void {
  const root = document.createElement('div');
  root.className = 'commands-editor';
  root.innerHTML = `<h2>Commands</h2>
    <p>Lange regels worden opgesplitst in maximaal 6 chatberichten van 200 tekens. Minimaal 3 seconden ertussen,
    10 seconden pauze na een antwoord en maximaal 10 botberichten per minuut. Er ontstaat geen wachtrij.</p>
    <p data-bot></p><p data-status role="status">Commands laden…</p>
    <form data-form><div data-list></div>
      <div class="command-toolbar"><button type="button" data-add disabled>＋ Commando toevoegen</button>
      <button type="submit" data-save disabled>Commands opslaan</button>
      <button type="button" data-reload>Opgeslagen versie laden</button></div>
    </form><section class="command-preview"><h3>Antwoordpreview</h3>
    <p>Bekijk het antwoord van je huidige bewerkingen. Deze preview verstuurt niets naar TikTok.</p>
    <form data-preview><label>Commando<input data-test placeholder="!discord" maxlength="31"></label>
    <button type="submit">Antwoord bekijken</button></form><pre data-result></pre></section>`;
  element('#otherpage').replaceChildren(root);
  const find = <T extends HTMLElement = HTMLElement>(selector: string): T => {
    const node = root.querySelector<T>(selector);
    if (!node) throw new Error('Commandoveld ontbreekt.');
    return node;
  };
  let revision = 0;
  let loading = false;
  let loaded = false;
  let sequence = 0;
  let allowed = false;
  let botEnabled = false;
  const status = (message: string): void => { find('[data-status]').textContent = message; };
  function lockForm(locked: boolean): void {
    find('[data-form]').querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement>('input, textarea, button')
      .forEach(field => { field.disabled = locked || !loaded || !allowed; });
    find<HTMLButtonElement>('[data-reload]').disabled = locked;
    find('[data-list]').classList.toggle('feature-disabled', !allowed);
  }

  currentAccess = value => {
    if (!root.isConnected) return;
    allowed = value.chat;
    find('[data-bot]').textContent = allowed
      ? botEnabled ? 'De bot verwerkt commands op de server zodra LIVE verbonden is.'
        : 'Botverbinding beschikbaar; botantwoorden staan uit op de server (BOT_ENABLED=false).' : value.reason;
    lockForm(loading);
  };

  function addRow(command: CommandDefinition): void {
    const id = ++sequence;
    const row = document.createElement('fieldset');
    row.className = 'command-card';
    row.innerHTML = `<legend>Commando</legend><div class="command-fields">
      <label for="trigger-${id}">Commando<input id="trigger-${id}" data-trigger required pattern="![a-zA-Z0-9_]{1,30}" maxlength="31" value="${escapeHTML(command.trigger)}" placeholder="!nieuw"></label>
      <label for="cooldown-${id}">Cooldown (seconden)<input id="cooldown-${id}" data-cooldown type="number" min="5" max="3600" required value="${command.cooldownSeconds}"></label>
      <label class="command-enabled"><input data-enabled type="checkbox" ${command.enabled ? 'checked' : ''}> Ingeschakeld</label>
      </div><label for="responses-${id}">Antwoorden (maximaal 1200 tekens totaal)
      <textarea id="responses-${id}" data-responses required>${escapeHTML(command.responses.join('\n'))}</textarea></label>
      <p data-plan role="status"></p>
      <button type="button" data-remove>Verwijderen</button>`;
    find('[data-list]').append(row);
    updatePlan(row);
  }

  function updatePlan(row: HTMLElement): void {
    const responses = row.querySelector<HTMLTextAreaElement>('[data-responses]')!.value.split(/\r?\n/).map(line => line.trim());
    const plan = planResponses(responses);
    const cooldown = Number(row.querySelector<HTMLInputElement>('[data-cooldown]')!.value);
    row.querySelector('[data-plan]')!.textContent = plan.error || `${plan.messages.length} chatbericht${plan.messages.length === 1 ? '' : 'en'}
      · ${plan.characters}/1200 tekens · minimaal ${plan.durationSeconds} seconden · effectieve cooldown ${Math.max(commandPolicy.minCooldownSeconds, cooldown || 0)} seconden.`;
    row.querySelector<HTMLTextAreaElement>('[data-responses]')!.setCustomValidity(plan.error);
  }

  function draft(): CommandDefinition[] {
    return [...root.querySelectorAll<HTMLElement>('.command-card')].map(row => ({
      trigger: row.querySelector<HTMLInputElement>('[data-trigger]')!.value.trim().toLowerCase(),
      cooldownSeconds: Number(row.querySelector<HTMLInputElement>('[data-cooldown]')!.value),
      enabled: row.querySelector<HTMLInputElement>('[data-enabled]')!.checked,
      responses: row.querySelector<HTMLTextAreaElement>('[data-responses]')!.value.split(/\r?\n/).map(text => text.trim())
    }));
  }

  function show(settings: CommandSettings): void {
    loaded = true;
    botEnabled = settings.botEnabled;
    revision = settings.revision;
    find('[data-list]').replaceChildren();
    for (const command of settings.commands) addRow(command);
    currentAccess?.(settings.capabilities);
    find('[data-result]').textContent = '';
  }

  async function load(): Promise<void> {
    if (loading) return;
    loading = true;
    lockForm(true);
    try {
      const response = await fetch('/api/commands');
      if (!response.ok) throw new Error('Commands laden mislukt.');
      const settings = await response.json() as CommandSettings;
      if (!root.isConnected) return;
      show(settings);
      status('Opgeslagen commands geladen.');
    } catch (error) { status(error instanceof Error ? error.message : 'Laden mislukt.'); }
    finally { loading = false; lockForm(false); }
  }

  find('[data-reload]').onclick = () => { void load(); };
  find('[data-add]').onclick = () => {
    if (draft().length >= 50) { status('Maximaal 50 commando’s toegestaan.'); return; }
    addRow({ trigger: '', responses: [''], cooldownSeconds: 60, enabled: true });
    status('Niet-opgeslagen wijzigingen.');
    const fields = root.querySelectorAll<HTMLInputElement>('[data-trigger]');
    fields[fields.length - 1]?.focus();
  };
  find('[data-list]').addEventListener('input', event => {
    const row = event.target instanceof Element ? event.target.closest<HTMLElement>('.command-card') : null;
    if (row) updatePlan(row);
    status('Niet-opgeslagen wijzigingen.');
  });
  find('[data-list]').addEventListener('click', event => {
    const button = event.target instanceof Element ? event.target.closest('[data-remove]') : null;
    if (button) { button.closest('fieldset')?.remove(); status('Niet-opgeslagen wijzigingen.'); }
  });
  find<HTMLFormElement>('[data-form]').onsubmit = async event => {
    event.preventDefault();
    if (loading || !allowed) return;
    loading = true;
    lockForm(true);
    try {
      const response = await fetch('/api/commands', { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'faynominaal' },
        body: JSON.stringify({ revision, commands: draft() }) });
      const result = await response.json() as CommandSettings & { error?: string };
      if (result.capabilities) currentAccess?.(result.capabilities);
      if (!response.ok) throw new Error(result.error || 'Opslaan mislukt.');
      if (!root.isConnected) return;
      show(result);
      status('Commands opgeslagen. Wijzigingen zijn direct actief op de server.');
    } catch (error) { status(error instanceof Error ? error.message : 'Opslaan mislukt.'); }
    finally { loading = false; lockForm(false); }
  };
  find<HTMLFormElement>('[data-preview]').onsubmit = event => {
    event.preventDefault();
    const trigger = find<HTMLInputElement>('[data-test]').value.trim().toLowerCase();
    const command = draft().find(item => item.trigger === trigger);
    const plan = command && planResponses(command.responses);
    find('[data-result]').textContent = !command ? 'Geen passend commando gevonden.' : !command.enabled
      ? 'Dit commando is uitgeschakeld.' : plan!.error || `${plan!.messages.map((text, index) => `${index + 1}/${plan!.messages.length}: ${text}`).join('\n\n')}\n\nMinimaal ${plan!.durationSeconds} seconden; cooldown ${Math.max(commandPolicy.minCooldownSeconds, command.cooldownSeconds)} seconden.`;
  };
  void load();
}
