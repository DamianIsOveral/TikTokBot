import { element, toast } from './dom.js';

export function initializePreferences(onChange?:()=>void): void {
  for (const [id, key, className, defaultValue] of [
    ['username-colors', 'fay-username-colors', 'username-colors',true],
    ['compact-mode', 'fay-compact', 'compact',true],
    ['user-avatars', 'fay-user-avatars', 'user-avatars',true],
    ['striped-rows', 'fay-striped-rows', 'striped-rows',false],
    ['high-contrast', 'fay-high-contrast', 'high-contrast',false]
  ] as const) {
    const checkbox = element<HTMLInputElement>(`#${id}`);
    checkbox.checked = defaultValue;
    try { const saved=localStorage.getItem(key); if(saved==='true'||saved==='false')checkbox.checked=saved==='true'; } catch {}
    const apply = () => document.body.classList.toggle(className, checkbox.checked);
    apply();
    checkbox.onchange = () => {
      apply();
      if(id==='user-avatars') { onChange?.(); document.dispatchEvent(new Event('avatar-preference-changed')); }
      try { localStorage.setItem(key, String(checkbox.checked)); }
      catch { toast('De weergave is aangepast; bewaren voor je volgende bezoek is niet gelukt.'); }
    };
  }
}
