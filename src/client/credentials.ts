import {isDashboardAdmin} from './auth.js';
import {showChatAccess} from './capabilities.js';
import {clearSessionCookies,decryptSessionpack,sessionpackError} from './sessionpack.js';
import type {SessionCookies} from './sessionpack.js';
import type {ChatCapabilities} from '../shared/capabilities.js';

export function mountCredentials(root:HTMLElement):void {
  if(!isDashboardAdmin())return;
  const section=document.createElement('section');
  section.innerHTML=`<details class="credential-editor"><summary>Botcookies herstellen (beheerder)</summary>
    <p>Importeer je versleutelde Session Lantern-export. Het exportwachtwoord blijft in deze browser.
    Controleren stopt de gedeelde LIVE, verifieert het ingestelde botaccount en bewaart de cookies privé op de server.</p>
    <form data-sessionpack autocomplete="off"><h3>Session Lantern importeren</h3>
    <p><a href="https://github.com/Zeffuro/SessionLantern/releases" target="_blank" rel="noopener noreferrer">Session Lantern downloaden ↗</a></p><div class="command-fields">
    <label>Versleuteld bestand (.sessionpack, maximaal 64 KiB)<input data-sessionpack-file type="file" accept=".sessionpack" required></label>
    <label>Exportwachtwoord<input data-sessionpack-password type="password" required autocomplete="off" spellcheck="false"></label>
    </div><p>Voer het exportwachtwoord exact in, inclusief spaties.</p>
    <button type="submit" disabled>Controleren en privé opslaan</button></form>
    <details><summary>Handmatig vier cookies invullen</summary>
    <form data-manual-cookies autocomplete="off"><div class="command-fields">
    <label>sessionid<input data-cookie="sessionId" type="password" required maxlength="256" autocomplete="off" spellcheck="false"></label>
    <label>tt-target-idc<input data-cookie="targetIdc" type="password" required maxlength="64" autocomplete="off" spellcheck="false"></label>
    <label>msToken<input data-cookie="msToken" type="password" required maxlength="1024" autocomplete="off" spellcheck="false"></label>
    <label>s_v_web_id / verifyFp<input data-cookie="verifyFp" type="password" required maxlength="200" autocomplete="off" spellcheck="false"></label>
    </div><button type="submit" disabled>Controleren en privé opslaan</button></form></details>
    <button type="button" data-clear-credentials>Invoer wissen</button>
    <p role="status" data-credential-status>Beschikbaarheid controleren…</p></details>`;
  root.append(section);
  const importForm=section.querySelector<HTMLFormElement>('[data-sessionpack]')!;
  const manualForm=section.querySelector<HTMLFormElement>('[data-manual-cookies]')!;
  const fileInput=section.querySelector<HTMLInputElement>('[data-sessionpack-file]')!;
  const passwordInput=section.querySelector<HTMLInputElement>('[data-sessionpack-password]')!;
  const clearButton=section.querySelector<HTMLButtonElement>('[data-clear-credentials]')!;
  const status=section.querySelector<HTMLElement>('[data-credential-status]')!;
  const fields=[...section.querySelectorAll<HTMLInputElement>('input')];
  const buttons=[...section.querySelectorAll<HTMLButtonElement>('button[type="submit"]')];
  let available=false,busy=false,generation=0;
  let controller:AbortController|undefined;
  const reset=()=>{importForm.reset();manualForm.reset();};
  const updateControls=()=>{
    fields.forEach(field=>{field.disabled=busy||!isDashboardAdmin();});
    buttons.forEach(button=>{button.disabled=busy||!available||!isDashboardAdmin();});
  };
  const cancel=()=>{
    generation++;controller?.abort();controller=undefined;reset();updateControls();
  };
  clearButton.onclick=()=>{cancel();status.textContent='Invoer gewist. Een al verstuurde controle kan op de server nog worden afgerond.';};
  section.addEventListener('input',()=>{if(busy){cancel();status.textContent='Invoer gewijzigd; controle afgebroken. Controleer de sessiestatus als de aanvraag al verstuurd was.';}else generation++;});
  section.addEventListener('change',()=>{if(busy){cancel();status.textContent='Invoer gewijzigd; controle afgebroken.';}else generation++;});
  const onPermissions=()=>{
    if(!isDashboardAdmin()){cancel();section.remove();}
  };
  document.addEventListener('dashboard-permissions-changed',onPermissions);
  const observer=new MutationObserver(()=>{
    if(section.isConnected)return;
    cancel();observer.disconnect();document.removeEventListener('dashboard-permissions-changed',onPermissions);
  });
  observer.observe(root,{childList:true});
  const availabilityGeneration=generation;
  void fetch('/api/bot-session',{cache:'no-store'}).then(async response=>{
    if(!response.ok)throw new Error();
    const value=await response.json() as {available:boolean;botUsername:string};
    available=value.available===true;
    if(generation===availabilityGeneration&&isDashboardAdmin())status.textContent=available
      ?`Verwacht botaccount: @${value.botUsername}. Kies een export of vul handmatig vier cookies in.`
      :'Herstel is niet beschikbaar: stel eerst directe modus en privéopslag in op de server.';
    updateControls();
  }).catch(()=>{if(generation===availabilityGeneration)status.textContent='Beschikbaarheid ophalen mislukt.';});

  const submit=async(importing:boolean)=>{
    if(busy||!available||!isDashboardAdmin())return;
    busy=true;const current=++generation;updateControls();
    const active=()=>current===generation&&isDashboardAdmin()&&section.isConnected;
    let cookies:SessionCookies|undefined;
    let submitted=false;
    try{
      if(importing){
        let file=fileInput.files?.[0];let password=passwordInput.value;
        reset();
        status.textContent='Bestand lokaal ontsleutelen… De LIVE wordt pas bij de servercontrole gestopt.';
        if(!file)throw new Error();
        try{cookies=await decryptSessionpack(file,password);}finally{file=undefined;password='';}
      }else{
        cookies=Object.fromEntries([...manualForm.querySelectorAll<HTMLInputElement>('[data-cookie]')]
          .map(field=>[field.dataset.cookie!,field.value.trim()])) as unknown as SessionCookies;
        reset();
      }
      if(!active())return;
      status.textContent='Gedeelde LIVE stoppen; botaccount controleren en privé opslaan…';
      controller=new AbortController();submitted=true;
      const response=await fetch('/api/bot-session',{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'faynominaal'},
        body:JSON.stringify(cookies),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(30_000)])});
      clearSessionCookies(cookies);
      const result=await response.json() as {error?:string;capabilities?:ChatCapabilities};
      if(!active())return;
      if(!response.ok){status.textContent=result.error||'Opslaan niet bevestigd. Controleer de botsessie.';return;}
      if(result.capabilities)showChatAccess(result.capabilities);
      status.textContent='Botcookies gecontroleerd en privé opgeslagen. Klik op Verbinden om de LIVE te hervatten.';
    }catch{
      if(active())status.textContent=submitted?'Opslag is niet bevestigd. Controleer de sessiestatus voordat je opnieuw probeert.':sessionpackError;
    }finally{
      clearSessionCookies(cookies);
      if(current===generation)reset();
      busy=false;controller=undefined;updateControls();
    }
  };
  importForm.onsubmit=event=>{event.preventDefault();void submit(true);};
  manualForm.onsubmit=event=>{event.preventDefault();void submit(false);};
}
