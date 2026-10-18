import { element } from './dom.js';
import type { FilterDocument, FilterSettings } from './filters.js';
import { fetchGlobalFilters, saveSettings, subscribeGlobalFilters, FilterSaveError } from './filters.js';
import { validFilterSettings } from '../shared/filter-settings.js';
import { registerUnsaved, confirmLeave } from './unsaved.js';

const rules = [
  { key: 'links', title: 'Links', description: 'Markeer berichten met http(s), www of “klik op deze link”.' },
  { key: 'spam', title: 'Herhaalde tekst', description: 'Markeer herhalingen en herhaald “volg mij”.' },
  { key: 'swearing', title: 'Woordenlijst', description: 'Markeer berichten die een woord uit de lijst bevatten, ook als deel van een langer woord.' }
] as const;
let releaseEditor: (() => void) | undefined;

export function mountFilters(onChange: () => void): void {
  releaseEditor?.();
  const root = document.createElement('div');
  root.className = 'filters-editor';
  root.innerHTML = `<header class="filters-heading"><div><h2>Filters</h2>
    <p>Gedeelde regels voor alle dashboards van deze bot.</p></div><span class="filters-shared">◎ Globaal</span></header>
    <p class="filters-explanation">Deze filters markeren berichten voor beoordeling. Dempen en blokkeren blijven handmatige acties.</p>
    <form data-form><fieldset class="filters-rules" data-fields disabled><legend>Berichten markeren</legend>
      ${rules.map(rule => `<label class="filter-card" data-rule="${rule.key}" for="filter-${rule.key}">
        <input id="filter-${rule.key}" data-setting="${rule.key}" type="checkbox" aria-describedby="filter-help-${rule.key}">
        <span class="filter-card-copy"><strong>${rule.title}</strong><span id="filter-help-${rule.key}">${rule.description}</span></span>
        <span data-rule-state class="filter-rule-state">○ Uit</span></label>`).join('')}
      <div class="filter-words"><label for="filter-words">Woorden gescheiden door komma’s</label>
        <textarea id="filter-words" data-words maxlength="4000" rows="5" aria-describedby="filter-words-help filter-words-count" spellcheck="false"></textarea>
        <div class="filter-words-meta"><span id="filter-words-help">Hoofdletters maken geen verschil. Lege woorden tellen niet mee.</span>
          <span id="filter-words-count" data-count>0 / 4000</span></div></div>
    </fieldset><div class="filters-actions"><div data-status class="filters-status" role="status" tabindex="-1">↻ Filters laden…</div>
      <div class="filters-buttons"><button type="submit" class="button-primary" data-save disabled>Filters opslaan</button>
        <button type="button" data-reload>Opgeslagen versie laden</button></div></div>
      <p data-external class="filters-external" role="status" hidden></p></form>`;
  element('#otherpage').replaceChildren(root);
  const find = <T extends HTMLElement = HTMLElement>(selector: string): T => {
    const node = root.querySelector<T>(selector);
    if (!node) throw new Error('Filterveld ontbreekt.');
    return node;
  };
  let revision = 0;
  let baseline = '';
  let loaded = false;
  let busy = false;
  let dirty = false;
  let saving = false;
  let remoteRevision = 0;
  const draft = (): FilterSettings => ({
    links: find<HTMLInputElement>('[data-setting="links"]').checked,
    spam: find<HTMLInputElement>('[data-setting="spam"]').checked,
    swearing: find<HTMLInputElement>('[data-setting="swearing"]').checked,
    words: find<HTMLTextAreaElement>('[data-words]').value
  });
  function status(text: string, tone: 'info' | 'success' | 'warning' | 'error' = 'info'): void {
    find('[data-status]').textContent = `${{ info: 'ℹ', success: '✓', warning: '●', error: '!' }[tone]} ${text}`;
    find('[data-status]').dataset.tone = tone;
    find('[data-status]').setAttribute('role', tone === 'error' ? 'alert' : 'status');
  }
  function lock(): void {
    find<HTMLFieldSetElement>('[data-fields]').disabled = busy || !loaded;
    find<HTMLButtonElement>('[data-save]').disabled = busy || !loaded || !dirty;
    find('[data-save]').textContent = saving ? 'Opslaan…' : 'Filters opslaan';
    find<HTMLButtonElement>('[data-reload]').disabled = busy;
  }
  function focusChanges(): void {
    const field = root.querySelector<HTMLElement>('.is-dirty input,.is-dirty textarea') || find('[data-status]');
    field.focus({ preventScroll: true }); field.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  function track(announce = true): void {
    const value = draft();
    dirty = loaded && JSON.stringify(value) !== baseline;
    const original = baseline ? JSON.parse(baseline) as FilterSettings : value;
    for (const rule of rules) {
      const card = find(`[data-rule="${rule.key}"]`);
      card.classList.toggle('is-enabled', value[rule.key]);
      card.classList.toggle('is-dirty', value[rule.key] !== original[rule.key]);
      card.querySelector('[data-rule-state]')!.textContent = value[rule.key] ? '✓ Aan' : '○ Uit';
    }
    find('.filter-words').classList.toggle('is-dirty', value.words !== original.words);
    find('[data-count]').textContent = `${value.words.length} / 4000`;
    document.querySelector('[data-page="Filters"]')?.setAttribute('data-unsaved', String(dirty));
    if (announce) status(dirty ? 'Onopgeslagen wijzigingen. Sla op om ze voor iedereen actief te maken.' : 'Geen onopgeslagen wijzigingen.', dirty ? 'warning' : 'info');
    lock();
  }
  function show(document: FilterDocument): void {
    revision = document.revision;
    loaded = true;
    for (const rule of rules) find<HTMLInputElement>(`[data-setting="${rule.key}"]`).checked = document.settings[rule.key];
    find<HTMLTextAreaElement>('[data-words]').value = document.settings.words;
    baseline = JSON.stringify(draft());
    track(false);
    find('[data-external]').hidden = remoteRevision <= revision;
  }
  const unsubscribe = subscribeGlobalFilters(document => {
    if (!root.isConnected) { unsubscribe(); return; }
    remoteRevision = Math.max(remoteRevision, document.revision);
    if (!loaded || document.revision <= revision || saving) return;
    if (!dirty) {
      show(document);
      status('Gedeelde filters bijgewerkt naar de nieuwste opgeslagen versie.', 'info');
    } else {
      find('[data-external]').hidden = false;
      find('[data-external]').textContent = 'Er is een nieuwe versie opgeslagen. Jouw wijzigingen blijven staan; laden vervangt ze na bevestiging.';
    }
  });
  const observer = new MutationObserver(() => {
    if (!root.isConnected) { unsubscribe(); observer.disconnect(); }
  });
  observer.observe(element('#otherpage'), { childList: true });
  releaseEditor = () => { unsubscribe(); observer.disconnect(); };
  async function load(): Promise<void> {
    if (busy) return;
    busy = true; lock(); status('Opgeslagen filters laden…');
    try {
      const document = await fetchGlobalFilters();
      if (!root.isConnected) return;
      show(document);
      status('Opgeslagen filters geladen. Deze regels gelden voor iedereen.');
    } catch { status('Laden mislukt. Controleer de verbinding en probeer opnieuw.', 'error'); }
    finally { busy = false; lock(); }
  }
  async function save(): Promise<boolean> {
    if (busy || !loaded) return false;
    if (!dirty) return true;
    const settings = draft();
    if (!validFilterSettings(settings)) {
      status('Niet opgeslagen: gebruik maximaal 4000 tekens zonder regeleinden of andere besturingstekens.', 'error');
      find('[data-words]').focus(); return false;
    }
    busy = saving = true; lock(); status('Filters opslaan… Wacht op de bevestiging.');
    try {
      const document = await saveSettings(settings, revision);
      if (!root.isConnected) return false;
      show(document);
      onChange();
      status(`Opgeslagen om ${new Date().toLocaleTimeString('nl-NL')}. Filters zijn voor iedereen actief.`, 'success');
      return true;
    } catch (error) {
      status(error instanceof FilterSaveError && error.status === 409
        ? 'Niet opgeslagen: iemand anders heeft filters aangepast. Jouw wijzigingen zijn bewaard; laad eerst de opgeslagen versie.'
        : 'Opslaan is niet bevestigd. Jouw wijzigingen blijven staan. Laad de opgeslagen versie om de server te controleren.', 'error');
      return false;
    } finally {
      busy = saving = false; lock();
      find('[data-status]').focus({ preventScroll: true });
    }
  }
  find('[data-form]').addEventListener('input', () => track());
  find<HTMLFormElement>('[data-form]').onsubmit = event => { event.preventDefault(); void save(); };
  find('[data-reload]').onclick = async () => { if (await confirmLeave()) await load(); };
  registerUnsaved({ connected: () => root.isConnected, dirty: () => dirty, busy: () => busy,
    canSave: () => loaded, focus: focusChanges, save });
  void load();
}
