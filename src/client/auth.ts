import type { DashboardUser, LoginStatus } from '../shared/auth.js';
import { element } from './dom.js';
import { confirmLeave } from './unsaved.js';
let activeUser:DashboardUser|undefined;
export function isDashboardAdmin():boolean{return activeUser?.role==='admin';}

export async function requireUser(): Promise<DashboardUser | undefined> {
  try {
    const response = await fetch('/auth/session');
    if (!response.ok) throw new Error();
    const status = await response.json() as LoginStatus;
    if (!status.authenticated || !status.user) { location.replace('/login'); return; }
    activeUser=status.user;
    element('#signed-in-user').textContent = `${status.user.name} · ${status.user.role === 'admin' ? 'beheerder' : 'gebruiker'}`;
    element('[data-page="Toegang"]').classList.toggle('hidden', status.user.role !== 'admin');
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
    if (!result.authenticated) { location.replace('/login'); return false; }
  } catch { /* Een netwerkonderbreking hoeft geen verlopen sessie te zijn. */ }
  return true;
}
