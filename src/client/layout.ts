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
  initializeToolbarMenus();
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

export function initializeToolbarMenus(): void {
  const menus=[...document.querySelectorAll<HTMLDetailsElement>('.display-preferences,#layout-options,.test-options')];
  for(const menu of menus) {
    menu.addEventListener('toggle',()=>{
      if(menu.open)for(const other of menus)if(other!==menu)other.open=false;
    });
    menu.addEventListener('keydown',event=>{
      if(event.key!=='Escape'||!menu.open)return;
      event.preventDefault();menu.open=false;menu.querySelector('summary')?.focus();
    });
  }
  document.addEventListener('click',event=>{
    const path=event.composedPath();
    for(const menu of menus)if(menu.open&&!path.includes(menu))menu.open=false;
  },{capture:true});
}
