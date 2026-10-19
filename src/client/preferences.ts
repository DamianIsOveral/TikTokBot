import { element, toast } from './dom.js';

export function initializePreferences(onChange?:()=>void): void {
  const actions = element<HTMLSelectElement>('#review-actions-mode');
  const recent = element<HTMLDetailsElement>('#recent-moderation');
  const recentToggle = element<HTMLInputElement>('#recent-moderation-toggle');
  const save = (key:string,value:string) => {
    try { localStorage.setItem(key,value); }
    catch { toast('De weergave is aangepast; bewaren voor je volgende bezoek is niet gelukt.'); }
  };
  const applyActions = () => {
    document.body.dataset.reviewActions = actions.value === 'auto'
      ? document.body.classList.contains('compact') ? 'compact' : 'full' : actions.value;
  };
  actions.value='auto'; recentToggle.checked=true;
  try {
    const saved=localStorage.getItem('fay-review-actions');
    if (saved && ['auto','compact','full','menu'].includes(saved)) actions.value=saved;
    recentToggle.checked=localStorage.getItem('fay-recent-moderation-visible')!=='false';
    recent.open=localStorage.getItem('fay-recent-moderation-open')==='true';
  } catch {}
  recent.hidden=!recentToggle.checked;
  actions.onchange=()=>{applyActions();save('fay-review-actions',actions.value);};
  recentToggle.onchange=()=>{
    recent.hidden=!recentToggle.checked;
    save('fay-recent-moderation-visible',String(recentToggle.checked));
    document.dispatchEvent(new Event('workspace-chrome-changed'));
  };
  recent.addEventListener('toggle',()=>{
    save('fay-recent-moderation-open',String(recent.open));
    document.dispatchEvent(new Event('workspace-chrome-changed'));
  });
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
    const apply = () => { document.body.classList.toggle(className, checkbox.checked); applyActions(); };
    apply();
    checkbox.onchange = () => {
      apply();
      if(id==='user-avatars') { onChange?.(); document.dispatchEvent(new Event('avatar-preference-changed')); }
      try { localStorage.setItem(key, String(checkbox.checked)); }
      catch { toast('De weergave is aangepast; bewaren voor je volgende bezoek is niet gelukt.'); }
    };
  }
}
