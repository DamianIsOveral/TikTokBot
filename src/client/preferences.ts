import { element, toast } from './dom.js';

export function initializePreferences(): void {
  const checkbox = element<HTMLInputElement>('#compact-mode');
  try { checkbox.checked = localStorage.getItem('fay-compact') === 'true'; } catch {}
  const apply = () => document.body.classList.toggle('compact', checkbox.checked);
  apply();
  checkbox.onchange = () => {
    apply();
    try { localStorage.setItem('fay-compact', String(checkbox.checked)); }
    catch { toast('De weergave is aangepast; bewaren voor je volgende bezoek is niet gelukt.'); }
  };
}
