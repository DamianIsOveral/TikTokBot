import type { ActivityEvent, ActivityKind } from '../shared/events.js';
import { displayTime, element, toast } from './dom.js';

const labels = { join: 'Binnenkomst', gift: 'Cadeau', follow: 'Volger', share: 'Gedeeld' };
const icons = { join: '↪', gift: '◇', follow: '+', share: '↗' };
let items: ActivityEvent[] = [];
let initialized = false;
let scheduled = false;
const enabled: Record<ActivityKind, boolean> = {join:true,gift:true,follow:true,share:true};

function render(): void {
  if (!initialized) return;
  const feed = element<HTMLOListElement>('#activity-feed');
  const rows = items.filter(item => enabled[item.kind]).reverse().map(item => {
    const row = document.createElement('li');
    row.className = `live-activity-row live-activity-${item.kind}`;
    const icon = document.createElement('span');
    icon.className = 'live-activity-icon'; icon.setAttribute('aria-hidden', 'true'); icon.textContent = icons[item.kind];
    const content = document.createElement('span');
    const label = document.createElement('strong'); label.textContent = labels[item.kind];
    const description = item.kind === 'gift' ? `${item.user} · ${item.gift || 'Cadeau'} ×${item.count || 1}`
      : `${item.user} ${item.kind === 'join' ? 'is binnengekomen' : item.kind === 'follow' ? 'volgt de LIVE' : 'heeft de LIVE gedeeld'}`;
    content.append(label, document.createElement('br'), document.createTextNode(description));
    const time = document.createElement('time'); time.dateTime = item.time; time.textContent = displayTime(item.time);
    row.append(icon, content, time);
    return row;
  });
  if (!rows.length) {
    const empty = document.createElement('li'); empty.className = 'live-activity-empty';
    empty.textContent = !Object.values(enabled).some(Boolean) ? 'Alle activiteitsoorten zijn verborgen. Kies hierboven wat je wilt zien.'
      : items.length ? 'Geen activiteit voor je selectie in de laatste 100 gebeurtenissen.'
        : 'Nog geen LIVE-activiteit voor je selectie.';
    rows.push(empty);
  }
  feed.replaceChildren(...rows);
}

function scheduleRender(): void {
  if (!initialized || scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => { scheduled = false; render(); });
}

export function initializeLiveActivity(): void {
  const toggle = element<HTMLInputElement>('#activity-toggle');
  const panel = element('#activity-panel');
  try {
    const saved: unknown = JSON.parse(localStorage.getItem('fay-live-activity-kinds') || '{}');
    if (saved && typeof saved === 'object') for (const kind of Object.keys(enabled) as ActivityKind[]) {
      const value = (saved as Record<string,unknown>)[kind];
      if (typeof value === 'boolean') enabled[kind] = value;
    }
  } catch {}
  const updateFilters = () => {
    document.querySelectorAll<HTMLButtonElement>('[data-activity-kind]').forEach(button => {
      button.setAttribute('aria-pressed', String(enabled[button.dataset.activityKind as ActivityKind]));
    });
    element('#activity-filter-summary').textContent = `Soorten activiteit · ${Object.values(enabled).filter(Boolean).length}/4`;
  };
  updateFilters();
  element('#activity-filters').onclick = event => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-activity-kind]') : null;
    const kind = button?.dataset.activityKind as ActivityKind | undefined;
    if (!kind || !Object.hasOwn(enabled,kind)) return;
    enabled[kind] = !enabled[kind];
    updateFilters();
    render();
    try { localStorage.setItem('fay-live-activity-kinds', JSON.stringify(enabled)); }
    catch { toast('De activiteitselectie is aangepast, maar kon niet worden bewaard.'); }
  };
  try { toggle.checked = localStorage.getItem('fay-live-activity') === 'true'; } catch {}
  const apply = () => { panel.hidden = !toggle.checked; toggle.setAttribute('aria-expanded', String(toggle.checked)); };
  toggle.setAttribute('aria-controls', panel.id);
  apply();
  toggle.addEventListener('change', () => {
    apply();
    try { localStorage.setItem('fay-live-activity', String(toggle.checked)); }
    catch { toast('De activiteitweergave is aangepast, maar kon niet worden bewaard.'); }
  });
  const hide = document.querySelector<HTMLButtonElement>('#activity-hide');
  if (hide) hide.onclick = () => { toggle.checked = false; toggle.dispatchEvent(new Event('change')); };
  initialized = true;
  render();
}

export function receiveLiveActivity(event: ActivityEvent): void {
  items.push(event);
  if (items.length > 100) items.shift();
  scheduleRender();
}

export function replaceLiveActivity(activity?: ActivityEvent[]): void {
  items = activity?.slice(-100) || [];
  scheduleRender();
}

export function resetLiveActivity(): void { replaceLiveActivity(); }
