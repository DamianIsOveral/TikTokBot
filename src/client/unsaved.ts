import { toast } from './dom.js';

interface Guard {
  connected(): boolean;
  dirty(): boolean;
  busy(): boolean;
  canSave(): boolean;
  focus(): void;
  save(): Promise<boolean>;
}
let active: Guard | undefined;
let pending: Promise<boolean> | undefined;
export function registerUnsaved(guard: Guard): void { active = guard; }
window.addEventListener('beforeunload', event => {
  if (active?.connected() && active.dirty()) { event.preventDefault(); event.returnValue = ''; }
});

export function confirmLeave(): Promise<boolean> {
  const guard = active;
  if (!guard?.connected() || !guard.dirty()) return Promise.resolve(true);
  if (guard.busy()) { toast('Opslaan is nog bezig. Wacht op de bevestiging.'); return Promise.resolve(false); }
  if (pending) return pending;
  pending = new Promise<boolean>(resolve => {
    const dialog = document.createElement('dialog');
    dialog.className = 'unsaved-dialog';
    dialog.innerHTML = `<h2>Onopgeslagen wijzigingen</h2><p>Je wijzigingen zijn nog niet opgeslagen.</p>
      <div><button data-stay autofocus>Terug naar wijzigingen</button>
      <button data-save class="button-primary" ${guard.canSave() ? '' : 'disabled'}>Opslaan en doorgaan</button>
      <button data-discard class="button-danger">Wijzigingen verwerpen</button></div>`;
    const finish = (leave: boolean) => { dialog.close(); dialog.remove(); if (!leave) guard.focus(); resolve(leave); };
    dialog.querySelector<HTMLButtonElement>('[data-stay]')!.onclick = () => finish(false);
    dialog.querySelector<HTMLButtonElement>('[data-discard]')!.onclick = () => finish(true);
    dialog.querySelector<HTMLButtonElement>('[data-save]')!.onclick = async () => {
      dialog.querySelectorAll('button').forEach(button => { button.disabled = true; });
      finish(await guard.save());
    };
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(false); });
    document.body.append(dialog); dialog.showModal();
  }).finally(() => { pending = undefined; });
  return pending;
}
