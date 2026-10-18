import { element, toast } from './dom.js';

export function initializePreferences(): void {
  const colors=element<HTMLInputElement>('#username-colors');
  try{colors.checked=localStorage.getItem('fay-username-colors')==='true';}catch{}
  const applyColors=()=>document.body.classList.toggle('username-colors',colors.checked);
  applyColors();colors.onchange=()=>{applyColors();try{localStorage.setItem('fay-username-colors',String(colors.checked));}catch{toast('Gebruikerskleuren zijn actief, maar konden niet worden bewaard.');}};
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
