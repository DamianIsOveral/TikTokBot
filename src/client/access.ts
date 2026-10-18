import type { AccessEntry, AccessSettings } from '../shared/auth.js';
import { element, escapeHTML } from './dom.js';

export function mountAccess(): void {
  const root = document.createElement('div');
  root.className = 'access-editor';
  root.innerHTML = `<h2>Dashboardtoegang</h2><p>Voeg Discord-IDs toe en noteer bij wie ze horen. Gebruikers bedienen de gedeelde bot; beheerders mogen ook toegang beheren.</p>
    <p data-status role="status">Toegangslijst laden…</p>
    <form data-form><div data-users></div><div class="access-toolbar">
    <button type="button" data-add disabled>＋ Discord-ID toevoegen</button>
    <button type="submit" data-save class="button-primary" disabled>Toegang opslaan</button>
    <button type="button" data-reload>Opgeslagen versie laden</button></div></form>
    <p>De vaste beheerders uit de serverinstellingen blijven altijd beheerder. Verwijderen trekt toegang en bestaande sessies direct in.</p>`;
  element('#otherpage').replaceChildren(root);
  const find = <T extends HTMLElement = HTMLElement>(selector: string): T => {
    const node = root.querySelector<T>(selector);
    if (!node) throw new Error('Toegangsveld ontbreekt.');
    return node;
  };
  let revision = 0;
  let protectedIds: string[] = [];
  let loaded = false;
  let busy = false;
  let sequence = 0;
  const status = (text: string): void => { find('[data-status]').textContent = text; };

  function lock(value: boolean): void {
    busy = value;
    root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('input, select, button')
      .forEach(field => { field.disabled = value || (!loaded && !field.hasAttribute('data-reload')) || field.hasAttribute('data-protected'); });
  }
  function addRow(user: AccessEntry): void {
    const fixed = protectedIds.includes(user.id);
    const row = document.createElement('div');
    const number = ++sequence;
    row.className = 'access-row';
    row.innerHTML = `<label for="discord-id-${number}">Discord-ID<input id="discord-id-${number}" data-id required pattern="[0-9]{17,20}" inputmode="numeric" maxlength="20" value="${escapeHTML(user.id)}" ${fixed ? 'data-protected' : ''}></label>
      <label for="discord-comment-${number}">Opmerking<input id="discord-comment-${number}" data-comment maxlength="120" placeholder="Naam of herkenbare omschrijving" value="${escapeHTML(user.comment ?? '')}"></label>
      <label for="discord-role-${number}">Rol<select id="discord-role-${number}" data-role ${fixed ? 'data-protected' : ''}>
      <option value="member" ${user.role === 'member' ? 'selected' : ''}>Gebruiker</option>
      <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Beheerder</option></select></label>
      <div class="access-row-action">${fixed ? '<span class="access-fixed">Vaste beheerder</span>' : '<button type="button" data-remove>Verwijderen</button>'}</div>`;
    find('[data-users]').append(row);
    lock(busy);
  }
  function show(settings: AccessSettings): void {
    revision = settings.revision;
    protectedIds = settings.protectedIds;
    loaded = true;
    find('[data-users]').replaceChildren();
    for (const user of settings.users) addRow(user);
  }
  async function load(): Promise<void> {
    if (busy) return;
    lock(true);
    try {
      const response = await fetch('/api/access');
      if (!response.ok) throw new Error('Alleen beheerders mogen deze lijst openen.');
      const settings = await response.json() as AccessSettings;
      if (root.isConnected) { show(settings); status('Opgeslagen toegangslijst geladen.'); }
    } catch (error) { status(error instanceof Error ? error.message : 'Laden mislukt.'); }
    finally { lock(false); }
  }
  find('[data-add]').onclick = () => {
    if (root.querySelectorAll('.access-row').length >= 500) { status('Maximaal 500 IDs toegestaan.'); return; }
    addRow({ id: '', role: 'member' });
    status('Niet-opgeslagen wijzigingen.');
  };
  find('[data-reload]').onclick = () => { void load(); };
  find('[data-users]').addEventListener('input', () => status('Niet-opgeslagen wijzigingen.'));
  find('[data-users]').addEventListener('click', event => {
    const button = event.target instanceof Element ? event.target.closest('[data-remove]') : null;
    if (button && !button.hasAttribute('data-protected')) { button.closest('.access-row')?.remove(); status('Niet-opgeslagen wijzigingen.'); }
  });
  find<HTMLFormElement>('[data-form]').onsubmit = async event => {
    event.preventDefault();
    if (busy) return;
    const users = [...root.querySelectorAll<HTMLElement>('.access-row')].map(row => ({
      id: row.querySelector<HTMLInputElement>('[data-id]')!.value.trim(),
      role: row.querySelector<HTMLSelectElement>('[data-role]')!.value,
      comment: row.querySelector<HTMLInputElement>('[data-comment]')!.value
    }));
    lock(true);
    try {
      const response = await fetch('/api/access', { method: 'POST', headers: {
        'Content-Type': 'application/json', 'X-Requested-With': 'faynominaal'
      }, body: JSON.stringify({ revision, users }) });
      const result = await response.json() as AccessSettings & { error?: string };
      if (!response.ok) throw new Error(result.error || 'Opslaan mislukt.');
      if (root.isConnected) { show(result); status('Toegang opgeslagen. Wijzigingen zijn direct actief.'); }
    } catch (error) { status(error instanceof Error ? error.message : 'Opslaan mislukt.'); }
    finally { lock(false); }
  };
  void load();
}
