import { element, toast } from './dom.js';

export function initializePreferences(): void {
  for (const [id, key, className] of [
    ['username-colors', 'fay-username-colors', 'username-colors'],
    ['compact-mode', 'fay-compact', 'compact'],
    ['striped-rows', 'fay-striped-rows', 'striped-rows'],
    ['high-contrast', 'fay-high-contrast', 'high-contrast']
  ]) {
    const checkbox = element<HTMLInputElement>(`#${id}`);
    try { checkbox.checked = localStorage.getItem(key) === 'true'; } catch {}
    const apply = () => document.body.classList.toggle(className, checkbox.checked);
    apply();
    checkbox.onchange = () => {
      apply();
      try { localStorage.setItem(key, String(checkbox.checked)); }
      catch { toast('De weergave is aangepast; bewaren voor je volgende bezoek is niet gelukt.'); }
    };
  }
}
