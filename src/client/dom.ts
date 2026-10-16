export function element<T extends HTMLElement = HTMLElement>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`Element ontbreekt: ${selector}`);
  return node;
}

export const escapeHTML = (value: unknown): string => String(value).replace(/[&<>"']/g,
  character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(text: string): void {
  const node = element('#toast');
  node.textContent = text;
  node.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('visible'), 4500);
}

export function displayTime(time?: string): string {
  return (time ? new Date(time) : new Date()).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
}
