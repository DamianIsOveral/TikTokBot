import {isDashboardAdmin} from './auth.js';
import {showChatAccess} from './capabilities.js';
import type {ChatCapabilities} from '../shared/capabilities.js';

export function mountCredentials(root:HTMLElement):void {
  if(!isDashboardAdmin())return;
  const section=document.createElement('section');
  section.innerHTML=`<details class="credential-editor"><summary>Botcookies herstellen (beheerder)</summary>
    <p>Plak de vier cookies van dezelfde botsessie. We controleren het ingestelde botaccount en bewaren ze privé op de server.
    Dit stopt de gedeelde LIVE-verbinding. Daarna kun je opnieuw verbinden. Bestaande waarden worden nooit getoond.</p>
    <form autocomplete="off"><div class="command-fields">
    <label>sessionid<input data-cookie="sessionId" type="password" required maxlength="256" autocomplete="off" spellcheck="false"></label>
    <label>tt-target-idc<input data-cookie="targetIdc" type="password" required maxlength="64" autocomplete="off" spellcheck="false"></label>
    <label>msToken<input data-cookie="msToken" type="password" required maxlength="1024" autocomplete="off" spellcheck="false"></label>
    <label>s_v_web_id / verifyFp<input data-cookie="verifyFp" type="password" required maxlength="200" autocomplete="off" spellcheck="false"></label>
    </div><button type="submit" disabled>Controleren en privé opslaan</button><p role="status" data-credential-status>Beschikbaarheid controleren…</p></form></details>`;
  root.append(section);
  const form=section.querySelector('form')!;
  const button=section.querySelector('button')!;
  const status=section.querySelector<HTMLElement>('[data-credential-status]')!;
  void fetch('/api/bot-session').then(async response=>{
    if(!response.ok)throw new Error();
    const value=await response.json() as {available:boolean;botUsername:string};
    status.textContent=value.available?`Verwacht botaccount: @${value.botUsername}. Vul alle vier nieuwe waarden in.`:'Herstel is niet beschikbaar: stel eerst directe modus en privéopslag in op de server.';
    button.disabled=!value.available;
  }).catch(()=>{status.textContent='Beschikbaarheid ophalen mislukt.';});
  form.onsubmit=async event=>{
    event.preventDefault();if(button.disabled)return;
    const fields=[...form.querySelectorAll<HTMLInputElement>('[data-cookie]')];
    const body=Object.fromEntries(fields.map(field=>[field.dataset.cookie!,field.value.trim()]));
    fields.forEach(field=>{field.disabled=true;});button.disabled=true;
    status.textContent='Botverbinding gestopt; nieuwe sessie controleren en opslaan…';
    try{
      const response=await fetch('/api/bot-session',{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'faynominaal'},
        body:JSON.stringify(body),signal:AbortSignal.timeout(30_000)});
      const result=await response.json() as {error?:string;capabilities?:ChatCapabilities};
      if(!response.ok){status.textContent=result.error||'Opslaan niet bevestigd. Controleer de botsessie.';return;}
      if(result.capabilities)showChatAccess(result.capabilities);
      status.textContent='Botcookies gecontroleerd en privé opgeslagen. Klik op Verbinden om de LIVE te hervatten.';
    }catch{status.textContent='Opslag is niet bevestigd. Controleer de sessiestatus voordat je opnieuw probeert.';}
    finally{form.reset();fields.forEach(field=>{field.disabled=false;});button.disabled=false;}
  };
}
