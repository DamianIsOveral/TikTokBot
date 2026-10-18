import { element } from './dom.js';

const defaultSplit = 100 * 1.15 / 2.15;
const sidebarKey = 'fay-sidebar-collapsed';
const splitKey = 'fay-chat-split';

function saved(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

function save(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch {}
}

export function initializeLayout(): void {
  const toggle = element<HTMLButtonElement>('#sidebar-toggle');
  const narrow = window.matchMedia('(max-width:1100px)');
  const stacked = window.matchMedia('(max-width:1300px)');
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

  const columns = element('#chatpage');
  const separator = element('#chat-resize');
  const storedSplit = Number(saved(splitKey));
  let preferredSplit = storedSplit > 0 && storedSplit < 100 ? storedSplit : defaultSplit;
  let currentSplit = preferredSplit;
  let pointer: number | null = null;
  let previousSplit = preferredSplit;
  const bounds = () => {
    const available = columns.clientWidth - separator.offsetWidth;
    const minimum = Math.min(45, 360 / Math.max(1, available) * 100);
    return { available, minimum, maximum: 100 - minimum };
  };
  const applySplit = () => {
    if (stacked.matches || !columns.clientWidth) return;
    const { minimum, maximum } = bounds();
    currentSplit = Math.min(maximum, Math.max(minimum, preferredSplit));
    columns.style.setProperty('--chat-share', `${currentSplit}fr`);
    columns.style.setProperty('--review-share', `${100 - currentSplit}fr`);
    separator.setAttribute('aria-valuemin', String(Math.ceil(minimum)));
    separator.setAttribute('aria-valuemax', String(Math.floor(maximum)));
    separator.setAttribute('aria-valuenow', String(Math.round(currentSplit)));
    separator.setAttribute('aria-valuetext', `Livechat ${Math.round(currentSplit)} procent`);
  };
  const rememberSplit = () => save(splitKey, String(preferredSplit));
  const reset = () => { preferredSplit = defaultSplit; applySplit(); rememberSplit(); };
  const endDrag = (cancelled = false) => {
    if (pointer === null) return;
    const id = pointer;
    pointer = null;
    document.body.classList.remove('resizing-chat');
    if (separator.hasPointerCapture(id)) separator.releasePointerCapture(id);
    if (cancelled) { preferredSplit = previousSplit; applySplit(); }
    else rememberSplit();
  };
  separator.addEventListener('pointerdown', event => {
    if (stacked.matches || event.button !== 0 || pointer !== null) return;
    event.preventDefault();
    separator.focus();
    pointer = event.pointerId;
    previousSplit = preferredSplit;
    separator.setPointerCapture(pointer);
    document.body.classList.add('resizing-chat');
  });
  separator.addEventListener('pointermove', event => {
    if (event.pointerId !== pointer || stacked.matches) return;
    const { available, minimum, maximum } = bounds();
    const position = event.clientX - columns.getBoundingClientRect().left - separator.offsetWidth / 2;
    preferredSplit = Math.min(maximum, Math.max(minimum, position / available * 100));
    applySplit();
  });
  separator.addEventListener('pointerup', event => { if (event.pointerId === pointer) endDrag(); });
  separator.addEventListener('pointercancel', () => endDrag(true));
  separator.addEventListener('lostpointercapture', () => endDrag());
  separator.addEventListener('dblclick', reset);
  separator.addEventListener('keydown', event => {
    if (stacked.matches) return;
    if (event.key === 'Escape' && pointer !== null) { endDrag(true); return; }
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter'].includes(event.key)) return;
    event.preventDefault();
    const { minimum, maximum } = bounds();
    if (event.key === 'Enter') { reset(); return; }
    preferredSplit = event.key === 'Home' ? minimum : event.key === 'End' ? maximum
      : Math.min(maximum, Math.max(minimum, currentSplit + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 10 : 2)));
    applySplit();
    rememberSplit();
  });
  stacked.addEventListener('change', () => { endDrag(); applySplit(); });
  new ResizeObserver(applySplit).observe(columns);
  applySplit();
}
