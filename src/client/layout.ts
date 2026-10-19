import { element } from './dom.js';
import {initializeWorkspace} from './workspace-layout.js';

const sidebarKey = 'fay-sidebar-collapsed';

function saved(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

function save(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch {}
}

export function initializeLayout(): void {
  const toggle = element<HTMLButtonElement>('#sidebar-toggle');
  const narrow = window.matchMedia('(max-width:1100px)');
  let sidebarPreference = saved(sidebarKey);
  const applySidebar = () => {
    const collapsed = sidebarPreference === null ? narrow.matches : sidebarPreference === 'true';
    document.body.classList.toggle('sidebar-collapsed', collapsed);
    document.body.classList.toggle('sidebar-expanded', !collapsed);
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.setAttribute('aria-label', collapsed ? 'Menu uitklappen' : 'Menu inklappen');
    toggle.title = collapsed ? 'Menu uitklappen' : 'Menu inklappen';
    toggle.textContent = collapsed ? '»' : '«';
  };
  toggle.onclick = () => {
    sidebarPreference = String(!document.body.classList.contains('sidebar-collapsed'));
    save(sidebarKey, sidebarPreference);
    applySidebar();
  };
  narrow.addEventListener('change', applySidebar);
  applySidebar();

  initializeWorkspace();
}
