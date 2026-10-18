import type { CommandDefinition, CommandSettings, CommandLimits } from '../shared/commands.js';
import { element, escapeHTML } from './dom.js';
import type { ChatCapabilities } from '../shared/capabilities.js';
import { commandPolicy, defaultCommandLimits, planResponses } from '../shared/command-policy.js';
import { commandTags, maximumTemplateContext, renderCommandTemplates } from '../shared/command-templates.js';
import { registerUnsaved, confirmLeave } from './unsaved.js';
import { state } from './model.js';

let currentAccess: ((value: ChatCapabilities) => void) | undefined;
let currentRevision: ((revision: number) => void) | undefined;
let checkRevision: (() => void) | undefined;
const audienceNames={everyone:'alle kijkers',moderators:'moderators en host',subscribers:'abonnees, moderators en host',supporters:'topgifters, abonnees, moderators en host'};
export function updateCommandAccess(value: ChatCapabilities): void { currentAccess?.(value); }
export function notifyCommandRevision(revision: number): void { currentRevision?.(revision); }
export function checkCommandRevision(): void { checkRevision?.(); }

export function mountCommands(): void {
  const root = document.createElement('div');
  root.className = 'commands-editor';
  root.innerHTML = `<h2>Commands</h2>
    <details class="command-help"><summary>Cooldowns, tags en toegangsregels</summary>
    <p>De ingestelde cooldown geldt per commando voor alle kijkers; aliases delen deze cooldown.
    Daarnaast: 30 seconden per kijker over alle commands, 10 seconden globale pauze na een antwoord,
    en de globale berichtlimieten hieronder. Geen wachtrij: opdrachten tijdens een pauze worden overgeslagen.</p>
    <p>Lange antwoorden: maximaal 6 chatberichten van 150 tekens. Dit is onze eigen voorzichtige grens, geen garantie tegen TikTok-beperkingen.
    Iedere deelregel telt mee voor het uurmaximum. Maximaal 10 aliases per commando.</p>
    <p>Tags: {username} is de @naam zonder @, {displayname} de zichtbare naam (maximaal 40 tekens),
    {channel} het LIVE-kanaal en {command} het hoofdcommando. Gewone tekst blijft ook mogelijk.</p>
    <p>Toegang geldt voor de TikTok-kijker die het commando typt. De host en moderators mogen alle commands gebruiken.
    Ontbrekende rolgegevens geven geen toegang tot beperkte commands. Topgifters betekent een herkende top-3-badge.</p></details>
    <p data-bot></p>
    <form data-form novalidate><div class="command-toolbar">
      <div data-status class="command-feedback" role="status" tabindex="-1">Commands laden…</div>
      <div class="command-buttons"><button type="submit" class="button-primary" data-save disabled>Commands opslaan</button>
      <button type="button" data-add disabled>＋ Commando toevoegen</button>
      <button type="button" data-reload>Opgeslagen versie laden</button>
      <button type="button" data-jump hidden>Toon wijzigingen</button></div></div>
      <p data-external class="command-external" role="status" hidden></p>
      <fieldset data-limits class="command-card command-limits"><legend>Globale botberichtlimieten</legend>
      <div class="command-fields"><label>Seconden tussen berichten<input data-interval type="number" min="30" max="300" required value="30"></label>
      <label>Maximaal berichten per uur<input data-hour type="number" min="5" max="120" required value="20"></label></div>
      <p>Gedeeld door alle commands en kijkers, ook binnen lange antwoorden. Een vol uurvenster slaat nieuwe opdrachten over.
      Het uurvenster blijft bij herverbinden behouden en begint opnieuw na een serverherstart.</p></fieldset><div data-list></div>
    </form><section class="command-preview"><h3>Antwoordpreview</h3>
    <p>Bekijk het antwoord van je huidige bewerkingen. Deze preview verstuurt niets naar TikTok.</p>
    <form data-preview><label>Commando<input data-test placeholder="!discord" maxlength="31"></label>
    <label>Voorbeeldgebruikersnaam<input data-preview-user value="zeffuro" maxlength="24" pattern="[a-zA-Z0-9_.]{1,24}" required></label>
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
  let dirty = false;
  let baseline = '';
  let baselineLimits = '';
  let remoteRevision = 0;
  let saving = false;
  const originals = new WeakMap<HTMLElement, string>();
  const status = (message: string, tone: 'info' | 'warning' | 'success' | 'error' | 'saving' = 'info'): void => {
    const node = find('[data-status]');
    node.textContent = `${{info:'ℹ',warning:'●',success:'✓',error:'!',saving:'↻'}[tone]} ${message}`;
    node.dataset.tone = tone;
    node.setAttribute('role', tone === 'error' ? 'alert' : 'status');
  };
  const revealStatus = () => {
    find('[data-status]').focus({preventScroll:true});
    find('[data-status]').scrollIntoView({block:'nearest',behavior:'smooth'});
  };
  function lockForm(locked: boolean): void {
    find('[data-form]').querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement | HTMLSelectElement>('input, textarea, button, select')
      .forEach(field => { field.disabled = locked || !loaded || !allowed; });
    find<HTMLButtonElement>('[data-reload]').disabled = locked;
    find<HTMLButtonElement>('[data-save]').disabled = locked || !loaded || !allowed || !dirty;
    find('[data-save]').textContent = saving ? 'Opslaan…' : 'Commands opslaan';
    find<HTMLButtonElement>('[data-jump]').disabled = false;
    find('[data-jump]').hidden = !dirty;
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
      <label for="cooldown-${id}">Cooldown per commando (seconden)<input id="cooldown-${id}" data-cooldown type="number" min="5" max="3600" required value="${command.cooldownSeconds}"></label>
      <label class="command-enabled"><input data-enabled type="checkbox" ${command.enabled ? 'checked' : ''}> Ingeschakeld</label>
      <label for="audience-${id}">Wie mag dit gebruiken?<select id="audience-${id}" data-audience>
      <option value="everyone">Alle kijkers</option><option value="moderators">Alleen moderators en host</option>
      <option value="subscribers">Abonnees, moderators en host</option>
      <option value="supporters">Topgifters, abonnees, moderators en host</option></select></label>
      </div><label for="aliases-${id}">Aliases (gescheiden door komma’s)
      <input id="aliases-${id}" data-aliases maxlength="400" value="${escapeHTML((command.aliases || []).join(', '))}" placeholder="!dc, !community"></label>
      <label for="responses-${id}">Antwoorden (maximaal 1200 tekens totaal)
      <textarea id="responses-${id}" data-responses required>${escapeHTML(command.responses.join('\n'))}</textarea></label>
      <div class="command-tags" aria-label="Tag invoegen">${commandTags.map(tag=>`<button type="button" data-tag="${tag}" title="Invoegen op de cursorpositie">{${tag}}</button>`).join('')}</div>
      <p data-plan role="status"></p>
      <button type="button" data-remove>Verwijderen</button>`;
    find('[data-list]').append(row);
    row.querySelector<HTMLSelectElement>('[data-audience]')!.value=command.audience||'everyone';
    updatePlan(row);
  }

  function updatePlan(row: HTMLElement): void {
    const responses = row.querySelector<HTMLTextAreaElement>('[data-responses]')!.value.split(/\r?\n/).map(line => line.trim());
    const rendered=renderCommandTemplates(responses,maximumTemplateContext);
    const plan = planResponses(rendered.responses,limitDraft());
    const error=rendered.error||plan.error;
    const cooldown = Number(row.querySelector<HTMLInputElement>('[data-cooldown]')!.value);
    row.querySelector('[data-plan]')!.textContent = error || `Bij de langste tagwaarden: ${plan.messages.length} chatbericht${plan.messages.length === 1 ? '' : 'en'}
      · ${plan.characters}/1200 tekens · minimaal ${plan.durationSeconds} seconden · effectieve commandcooldown ${Math.max(commandPolicy.minCooldownSeconds, cooldown || 0)} seconden.`;
    row.querySelector<HTMLTextAreaElement>('[data-responses]')!.setCustomValidity(error);
  }

  function rowDraft(row: HTMLElement): CommandDefinition {
    return {
      trigger: row.querySelector<HTMLInputElement>('[data-trigger]')!.value.trim().toLowerCase(),
      aliases: row.querySelector<HTMLInputElement>('[data-aliases]')!.value.split(',').map(text => text.trim().toLowerCase()).filter(Boolean),
      cooldownSeconds: Number(row.querySelector<HTMLInputElement>('[data-cooldown]')!.value),
      enabled: row.querySelector<HTMLInputElement>('[data-enabled]')!.checked,
      audience: row.querySelector<HTMLSelectElement>('[data-audience]')!.value as CommandDefinition['audience'],
      responses: row.querySelector<HTMLTextAreaElement>('[data-responses]')!.value.split(/\r?\n/).map(text => text.trim())
    };
  }
  function draft(): CommandDefinition[] {
    return [...root.querySelectorAll<HTMLElement>('[data-list] .command-card')].map(rowDraft);
  }
  function limitDraft(): CommandLimits {
    return {intervalSeconds:Number(find<HTMLInputElement>('[data-interval]').value),
      maxMessagesPerHour:Number(find<HTMLInputElement>('[data-hour]').value)};
  }
  function draftKey(): string { return JSON.stringify({commands:draft(),limits:limitDraft()}); }
  function track(announce = true): void {
    dirty = loaded && draftKey() !== baseline;
    find('[data-limits]').classList.toggle('is-dirty',baselineLimits!==JSON.stringify(limitDraft()));
    root.querySelectorAll<HTMLElement>('[data-list] .command-card').forEach(row => {
      row.classList.toggle('is-dirty', originals.get(row) !== JSON.stringify(rowDraft(row)));
    });
    document.querySelector('[data-page="Commands"]')?.setAttribute('data-unsaved', String(dirty));
    if (announce) {
      status(dirty ? 'Onopgeslagen wijzigingen. Sla op om ze actief te maken.' : 'Geen onopgeslagen wijzigingen.', dirty ? 'warning' : 'info');
      if(find('[data-result]').textContent)find('[data-result]').textContent='Voorbeeld verouderd door je wijzigingen. Klik op Antwoord bekijken.';
    }
    lockForm(loading);
  }
  function focusChanges(): void {
    const first = root.querySelector<HTMLElement>('.is-dirty') || find('[data-status]');
    first.scrollIntoView({block:'center',behavior:'smooth'});
    (first.querySelector<HTMLElement>('input,textarea,select') || first).focus({preventScroll:true});
  }
  function remoteChanged(next: number): void {
    if (!root.isConnected || !Number.isSafeInteger(next)) return;
    remoteRevision = Math.max(remoteRevision, next);
    if (!loaded || next <= revision) return;
    find('[data-external]').hidden = false;
    find('[data-external]').textContent = dirty ? 'Er is ook een nieuwe versie opgeslagen. Je eigen wijzigingen blijven hier staan; opnieuw opslaan overschrijft die versie niet.'
      : 'Er is een nieuwe commandoversie opgeslagen. Laad de opgeslagen versie om die te bekijken.';
  }
  currentRevision = remoteChanged;
  checkRevision = () => { if (root.isConnected && loaded) void fetch('/api/commands').then(response => response.ok ? response.json() : undefined)
    .then(result => { if (result) remoteChanged((result as CommandSettings).revision); }).catch(() => {}); };

  function show(settings: CommandSettings): void {
    loaded = true;
    botEnabled = settings.botEnabled;
    revision = settings.revision;
    const limits=settings.limits||defaultCommandLimits;
    find<HTMLInputElement>('[data-interval]').value=String(limits.intervalSeconds);
    find<HTMLInputElement>('[data-hour]').value=String(limits.maxMessagesPerHour);
    baselineLimits=JSON.stringify(limitDraft());
    find('[data-list]').replaceChildren();
    for (const command of settings.commands) addRow(command);
    baseline = draftKey();
    root.querySelectorAll<HTMLElement>('[data-list] .command-card').forEach(row => originals.set(row,JSON.stringify(rowDraft(row))));
    track(false);
    find('[data-external]').hidden = remoteRevision <= revision;
    if (remoteRevision > revision) remoteChanged(remoteRevision);
    currentAccess?.(settings.capabilities);
    find('[data-result]').textContent = '';
  }

  async function load(): Promise<void> {
    if (loading) return;
    loading = true;
    lockForm(true);
    status('Opgeslagen versie laden…','saving');
    try {
      const response = await fetch('/api/commands');
      if (!response.ok) throw new Error('Commands laden mislukt.');
      const settings = await response.json() as CommandSettings;
      if (!root.isConnected) return;
      show(settings);
      status('Opgeslagen commands geladen.','info');
    } catch { status('Laden mislukt. Controleer de verbinding en probeer opnieuw.','error'); }
    finally { loading = false; lockForm(false); }
  }

  find('[data-reload]').onclick = async () => { if (await confirmLeave()) await load(); };
  find('[data-jump]').onclick = focusChanges;
  find('[data-add]').onclick = () => {
    if (draft().length >= 50) { status('Maximaal 50 commando’s toegestaan.','error'); return; }
    addRow({ trigger: '', responses: [''], cooldownSeconds: 60, enabled: true, audience:'moderators' });
    track();
    const fields = root.querySelectorAll<HTMLInputElement>('[data-trigger]');
    fields[fields.length - 1]?.focus();
  };
  find('[data-list]').addEventListener('input', event => {
    const row = event.target instanceof Element ? event.target.closest<HTMLElement>('.command-card') : null;
    if (row) { row.querySelectorAll<HTMLInputElement>('input').forEach(input => input.setCustomValidity('')); updatePlan(row); }
    track();
  });
  find('[data-list]').addEventListener('click', event => {
    const tag=event.target instanceof Element?event.target.closest<HTMLButtonElement>('[data-tag]'):null;
    if(tag){
      const textarea=tag.closest('fieldset')!.querySelector<HTMLTextAreaElement>('textarea')!;
      textarea.setRangeText(`{${tag.dataset.tag}}`,textarea.selectionStart,textarea.selectionEnd,'end');
      textarea.focus();textarea.dispatchEvent(new Event('input',{bubbles:true}));return;
    }
    const button = event.target instanceof Element ? event.target.closest('[data-remove]') : null;
    if (button) { button.closest('fieldset')?.remove(); track(); }
  });
  find('[data-limits]').addEventListener('input',()=>{
    root.querySelectorAll<HTMLElement>('.command-card:not([data-limits])').forEach(updatePlan);track();
  });
  function validateFields(): boolean {
    const names = new Set<string>();
    const rows = [...root.querySelectorAll<HTMLElement>('[data-list] .command-card')];
    rows.forEach(row => {
      const trigger = row.querySelector<HTMLInputElement>('[data-trigger]')!;
      const aliases = row.querySelector<HTMLInputElement>('[data-aliases]')!;
      trigger.setCustomValidity(''); aliases.setCustomValidity('');
      const command = rowDraft(row);
      if (!/^![a-z0-9_]{1,30}$/.test(command.trigger)) trigger.setCustomValidity('Gebruik ! gevolgd door 1–30 letters, cijfers of underscores.');
      if (names.has(command.trigger)) trigger.setCustomValidity(`Commando ${command.trigger} wordt al gebruikt.`);
      names.add(command.trigger);
      updatePlan(row);
    });
    rows.forEach(row => {
      const aliases = row.querySelector<HTMLInputElement>('[data-aliases]')!;
      const values = rowDraft(row).aliases || [];
      if (values.length > 10) aliases.setCustomValidity('Maximaal 10 aliases per commando.');
      for (const name of values) {
        if (!/^![a-z0-9_]{1,30}$/.test(name)) aliases.setCustomValidity('Gebruik ! gevolgd door 1–30 letters, cijfers of underscores.');
        if (names.has(name)) aliases.setCustomValidity(`Commando of alias ${name} wordt al gebruikt.`);
        names.add(name);
      }
    });
    const invalid = root.querySelector<HTMLInputElement | HTMLTextAreaElement>('[data-form] input:invalid,[data-form] textarea:invalid');
    if (!invalid) return true;
    status('Niet opgeslagen. Controleer het gemarkeerde veld.','error');
    invalid.scrollIntoView({block:'center',behavior:'smooth'}); invalid.focus({preventScroll:true}); invalid.reportValidity();
    return false;
  }
  async function save(): Promise<boolean> {
    if (loading || !allowed) return false;
    if (!dirty) return true;
    if (!validateFields()) return false;
    const commands = draft();
    saving = true;
    loading = true;
    lockForm(true);
    status('Commands opslaan… Wacht op de bevestiging.','saving');
    let failure = 'Opslaan is niet bevestigd. Je wijzigingen blijven staan. Controleer de verbinding en laad de opgeslagen versie voordat je opnieuw probeert.';
    try {
      const response = await fetch('/api/commands', { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'faynominaal' },
        signal:AbortSignal.timeout(10_000), body: JSON.stringify({ revision, commands, limits:limitDraft() }) });
      const result = await response.json() as CommandSettings & { error?: string; currentRevision?: number };
      if (result.capabilities) currentAccess?.(result.capabilities);
      if (!response.ok) {
        failure = response.status === 409 ? 'Niet opgeslagen: iemand anders heeft commands aangepast. Jouw wijzigingen zijn bewaard in dit scherm; laad eerst de nieuwe versie.' : result.error || 'Opslaan mislukt. Je wijzigingen blijven staan.';
        if (result.currentRevision) remoteChanged(result.currentRevision);
        throw new Error();
      }
      if (!root.isConnected) return false;
      show(result);
      status(`Opgeslagen om ${new Date().toLocaleTimeString('nl-NL',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}. Commands zijn direct actief.`,'success');
      revealStatus(); return true;
    } catch { status(failure,'error'); revealStatus(); return false; }
    finally { loading = saving = false; lockForm(false); }
  }
  find<HTMLFormElement>('[data-form]').onsubmit = event => {
    event.preventDefault(); void save();
  };
  registerUnsaved({connected:()=>root.isConnected,dirty:()=>dirty,busy:()=>loading,canSave:()=>allowed,focus:focusChanges,save});
  find<HTMLFormElement>('[data-preview]').onsubmit = event => {
    event.preventDefault();
    const trigger = find<HTMLInputElement>('[data-test]').value.trim().toLowerCase();
    const command = draft().find(item => item.trigger === trigger || item.aliases?.includes(trigger));
    const username=find<HTMLInputElement>('[data-preview-user]').value;
    const rendered=command&&renderCommandTemplates(command.responses,{username,displayname:username,channel:state.username,command:command.trigger});
    const plan = rendered && planResponses(rendered.responses,limitDraft());
    find('[data-result]').textContent = !command ? 'Geen passend commando gevonden.' : !command.enabled
      ? 'Dit commando is uitgeschakeld.' : rendered!.error || plan!.error || `${plan!.messages.map((text, index) => `${index + 1}/${plan!.messages.length}: ${text}`).join('\n\n')}\n\nMinimaal ${plan!.durationSeconds} seconden; commandcooldown ${Math.max(commandPolicy.minCooldownSeconds, command.cooldownSeconds)} seconden.\nToegang: ${audienceNames[command.audience||'everyone']} (preview controleert geen echte kijkerrol).`;
  };
  void load();
}
