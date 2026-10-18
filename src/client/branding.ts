import { isDashboardAdmin } from './auth.js';
import { registerUnsaved } from './unsaved.js';
import { maximumIconBytes, validBrandingMetadata } from '../shared/branding.js';
import type { BrandingMetadata } from '../shared/branding.js';

let metadata: BrandingMetadata = { revision: 0, hasIcon: false };

export function refreshBranding(): void {
  const url = `/branding/icon?revision=${metadata.revision}`;
  const favicon = document.querySelector<HTMLLinkElement>('#dashboard-favicon');
  if (favicon) favicon.href = url;
  const avatar = document.querySelector<HTMLElement>('#channel-avatar');
  if (!avatar) return;
  avatar.querySelector('img')?.remove();
  const initial = document.querySelector('#channel')?.textContent?.replace(/^@/, '').match(/[a-z0-9]/i)?.[0].toUpperCase() || 'F';
  avatar.replaceChildren(document.createTextNode(initial));
  if (!metadata.hasIcon) return;
  const image = document.createElement('img');
  image.alt = '';
  image.src = url;
  image.onerror = () => image.remove();
  avatar.append(image);
}

async function fetchBranding(): Promise<BrandingMetadata> {
  const response = await fetch('/api/branding', { signal: AbortSignal.timeout(10_000) });
  const result: unknown = await response.json();
  if (!response.ok || !validBrandingMetadata(result)) throw new Error('Het huidige icoon kon niet worden opgehaald.');
  metadata = result;
  return result;
}

export function initializeBranding(): void {
  refreshBranding();
  void fetchBranding().then(refreshBranding).catch(() => {});
}

async function prepareIcon(file: File, canvas: HTMLCanvasElement): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Kies een PNG-, JPG- of WebP-afbeelding. SVG wordt niet ondersteund.');
  if (!file.size || file.size > 5 * 1024 * 1024) throw new Error('Kies een afbeelding van maximaal 5 MiB.');
  let image: ImageBitmap;
  try { image = await createImageBitmap(file); }
  catch { throw new Error('Deze afbeelding kan niet worden geopend. Kies een geldige PNG, JPG of WebP.'); }
  try {
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext('2d');
    if (!context || !image.width || !image.height) throw new Error('Afbeeldingen verwerken is niet beschikbaar in deze browser.');
    const scale = Math.min(256 / image.width, 256 / image.height, 1);
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    context.clearRect(0, 0, 256, 256);
    context.drawImage(image, Math.round((256 - width) / 2), Math.round((256 - height) / 2), width, height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value)
      : reject(new Error('De afbeelding kon niet worden verwerkt.')), 'image/png'));
    if (blob.size > maximumIconBytes) throw new Error('De verwerkte afbeelding is te groot. Kies een kleinere afbeelding.');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    return btoa(binary);
  } finally { image.close(); }
}

export function mountBranding(root: HTMLElement): void {
  const section = document.createElement('section');
  section.className = 'branding-editor';
  section.innerHTML = `<h3>Dashboardicoon</h3>
    <p>Dit gedeelde icoon verschijnt in het browsertabblad en naast het kanaal. Zonder upload gebruiken we de kanaalinitiaal.</p>
    <div class="branding-content"><div class="branding-preview"><img data-branding-preview alt="Huidig dashboardicoon" src="/branding/icon"><canvas class="hidden" aria-label="Voorbeeld nieuw dashboardicoon"></canvas></div>
    <div class="branding-controls"></div></div><p role="status" data-branding-status>Huidig icoon laden…</p>`;
  root.append(section);
  const status = section.querySelector<HTMLElement>('[data-branding-status]')!;
  const preview = section.querySelector<HTMLImageElement>('[data-branding-preview]')!;
  const canvas = section.querySelector('canvas')!;
  if (!isDashboardAdmin()) {
    status.textContent = 'Alleen beheerders kunnen het gedeelde dashboardicoon aanpassen.';
    return;
  }
  const controls = section.querySelector<HTMLElement>('.branding-controls')!;
  controls.innerHTML = `<label class="branding-file">Afbeelding kiezen<input type="file" accept="image/png,image/jpeg,image/webp" disabled></label>
    <span class="branding-help">PNG, JPG of WebP · maximaal 5 MiB · wordt opgeslagen als 256 × 256 PNG</span>
    <div class="branding-actions"><button type="button" data-branding-save disabled>Icoon opslaan</button>
    <button type="button" data-branding-remove disabled>Icoon verwijderen</button>
    <button type="button" data-branding-reload>Huidige versie laden</button></div>`;
  const input = controls.querySelector('input')!;
  const save = controls.querySelector<HTMLButtonElement>('[data-branding-save]')!;
  const remove = controls.querySelector<HTMLButtonElement>('[data-branding-remove]')!;
  const reload = controls.querySelector<HTMLButtonElement>('[data-branding-reload]')!;
  let current: BrandingMetadata | undefined;
  let draft: string | undefined;
  let busy = false;
  let conflicted = false;
  const updateControls = () => {
    input.disabled = busy || !current;
    save.disabled = busy || !current || draft === undefined || conflicted;
    remove.disabled = busy || !current?.hasIcon || conflicted;
    reload.disabled = busy;
  };
  const load = async () => {
    busy = true; updateControls();
    try {
      current = await fetchBranding();
      draft = undefined; conflicted = false; input.value = '';
      preview.src = `/branding/icon?revision=${current.revision}`;
      preview.classList.remove('hidden'); canvas.classList.add('hidden');
      refreshBranding();
      status.textContent = current.hasIcon ? 'Gedeeld icoon geladen. Kies een afbeelding om het te vervangen.' : 'Kanaalinitiaal actief. Kies een afbeelding om een icoon toe te voegen.';
    } catch (error) { status.textContent = error instanceof Error ? error.message : 'Icoon ophalen mislukt.'; }
    finally { busy = false; updateControls(); }
  };
  const persist = async (icon: string | null): Promise<boolean> => {
    if (!current || busy || conflicted) return false;
    busy = true; updateControls(); status.textContent = 'Icoon opslaan…';
    try {
      const response = await fetch('/api/branding', { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'faynominaal' },
        body: JSON.stringify({ revision: current.revision, icon }), signal: AbortSignal.timeout(15_000) });
      const result: unknown = await response.json();
      if (!response.ok || !validBrandingMetadata(result)) {
        if (response.status === 409) conflicted = true;
        const message = result && typeof result === 'object' && 'error' in result ? String(result.error) : 'Opslaan niet bevestigd.';
        throw new Error(message);
      }
      current = metadata = result;
      draft = undefined; input.value = '';
      preview.src = `/branding/icon?revision=${current.revision}`;
      preview.classList.remove('hidden'); canvas.classList.add('hidden');
      refreshBranding();
      status.textContent = icon === null ? 'Icoon verwijderd. De kanaalinitiaal is weer actief.' : 'Icoon opgeslagen voor het hele dashboard.';
      return true;
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'Opslag niet bevestigd. Laad de huidige versie voordat je opnieuw probeert.';
      return false;
    } finally { busy = false; updateControls(); }
  };
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file || busy) return;
    busy = true; updateControls(); status.textContent = 'Afbeelding verwerken…';
    try {
      draft = await prepareIcon(file, canvas);
      preview.classList.add('hidden'); canvas.classList.remove('hidden');
      status.textContent = 'Voorbeeld gereed. Klik op Icoon opslaan om het voor iedereen toe te passen.';
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'Afbeelding verwerken mislukt.';
      draft = undefined;
      preview.classList.remove('hidden'); canvas.classList.add('hidden');
      input.value = '';
    } finally { busy = false; updateControls(); }
  };
  save.onclick = () => { if (draft !== undefined) void persist(draft); };
  remove.onclick = () => { void persist(null); };
  reload.onclick = () => { void load(); };
  registerUnsaved({ connected: () => section.isConnected, dirty: () => draft !== undefined, busy: () => busy,
    canSave: () => !save.disabled, focus: () => save.focus(), save: () => draft === undefined ? Promise.resolve(true) : persist(draft) });
  void load();
}
