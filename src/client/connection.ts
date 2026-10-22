import type { ClientEvent, PublicConfig, ServerEvent } from '../shared/events.js';
import { checkSession, canManageBot } from './auth.js';
import { element, toast } from './dom.js';

export function initializeStopButton(stop:()=>Promise<void>,refresh:()=>void):void {
  const button=element<HTMLButtonElement>('#stop');
  let pending=false;
  button.onclick=async()=>{
    if(pending||!canManageBot())return;
    pending=true;
    try{
      if(!await confirmStop()||!canManageBot())return;
      button.disabled=true;
      await stop();
    }
    catch{toast('Stoppen mislukt. Controleer de serververbinding.');}
    finally{pending=false;refresh();}
  };
}

function confirmStop():Promise<boolean> {
  return new Promise(resolve=>{
    const dialog=document.createElement('dialog');
    dialog.className='unsaved-dialog';
    dialog.setAttribute('aria-labelledby','stop-confirm-title');
    dialog.innerHTML=`<h2 id="stop-confirm-title">LIVE-verbinding stoppen?</h2>
      <p>Dit stopt de gedeelde botverbinding voor alle dashboardgebruikers. De bot ontvangt dan geen LIVE-berichten meer en reageert niet op commands.</p>
      <div><button data-cancel autofocus>Annuleren</button><button data-stop class="button-danger">Verbinding stoppen</button></div>`;
    const finish=(accepted:boolean)=>{dialog.close();dialog.remove();resolve(accepted);};
    dialog.querySelector<HTMLButtonElement>('[data-cancel]')!.onclick=()=>finish(false);
    dialog.querySelector<HTMLButtonElement>('[data-stop]')!.onclick=()=>finish(true);
    dialog.addEventListener('cancel',event=>{event.preventDefault();finish(false);});
    document.body.append(dialog);dialog.showModal();
  });
}

export function createConnection(onEvent: (event: ClientEvent) => void) {
  let stream: EventSource | undefined;
  function subscribe(): void {
    stream?.close();
    stream = new EventSource('/api/events');
    stream.onmessage = event => onEvent(JSON.parse(event.data) as ServerEvent);
    stream.onerror = () => {
      onEvent({ type: 'transport', text: 'Serververbinding onderbroken. Opnieuw verbinden…' });
      void checkSession().then(valid => { if (!valid) stream?.close(); });
    };
  }
  async function request(action: 'connect' | 'stop'): Promise<void> {
    const response = await fetch(`/api/${action}`, {
      method: 'POST', headers: { 'X-Requested-With': 'faynominaal' }
    });
    if (!response.ok) throw new Error('Serveractie mislukt.');
  }
  return {
    subscribe,
    async connect(): Promise<void> { await request('connect'); subscribe(); },
    stop: () => request('stop'),
    async config(): Promise<PublicConfig> {
      const response = await fetch('/api/config');
      if (!response.ok) throw new Error('Serverinstellingen ophalen mislukt.');
      return response.json() as Promise<PublicConfig>;
    }
  };
}
