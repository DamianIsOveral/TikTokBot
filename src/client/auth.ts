import type { DashboardUser, LoginStatus } from '../shared/auth.js';
import { element } from './dom.js';
import { confirmLeave } from './unsaved.js';
let activeUser:DashboardUser|undefined;
export function isDashboardAdmin():boolean{return activeUser?.role==='admin';}
export function canManageBot():boolean{return activeUser?.role==='admin'||activeUser?.role==='head-moderator';}
export function canOpenPage(page:string):boolean {
  return page==='Toegang'||page==='Instellingen' ? isDashboardAdmin()
    : page==='Commands'||page==='Filters' ? canManageBot() : true;
}

function applyUser(user:DashboardUser):void {
  const changed=activeUser!==undefined&&activeUser.role!==user.role;
  activeUser=user;
  const label=user.role==='admin'?'beheerder':user.role==='head-moderator'?'hoofd-moderator':'moderator';
  element('#signed-in-user').textContent=`${user.name} · ${label}`;
  document.querySelectorAll<HTMLElement>('[data-page]').forEach(button=>button.classList.toggle('hidden',!canOpenPage(button.dataset.page||'')));
  for(const id of ['connect','stop'])element(`#${id}`).classList.toggle('hidden',!canManageBot());
  if(changed)document.dispatchEvent(new Event('dashboard-permissions-changed'));
}

export async function requireUser(): Promise<DashboardUser | undefined> {
  try {
    const response = await fetch('/auth/session');
    if (!response.ok) throw new Error();
    const status = await response.json() as LoginStatus;
    if (!status.authenticated || !status.user) { location.replace('/login'); return; }
    applyUser(status.user);
    element('#logout').onclick = async () => {
      if (!await confirmLeave()) return;
      const logout = await fetch('/auth/logout', { method: 'POST', headers: { 'X-Requested-With': 'faynominaal' } });
      if (logout.ok) location.replace('/login');
    };
    return status.user;
  } catch { element('#live-status').textContent = 'Loginstatus kon niet worden gecontroleerd. Vernieuw de pagina.'; }
}

export async function checkSession(): Promise<boolean> {
  try {
    const response = await fetch('/auth/session');
    const result = await response.json() as LoginStatus;
    if (!result.authenticated||!result.user) { location.replace('/login'); return false; }
    applyUser(result.user);
  } catch { /* Een netwerkonderbreking hoeft geen verlopen sessie te zijn. */ }
  return true;
}
