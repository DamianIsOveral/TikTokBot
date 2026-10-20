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
    <div class="credential-feedback" data-credential-feedback data-tone="saving" role="status" aria-live="polite" aria-atomic="true" tabindex="-1">
    <strong data-credential-title>Beschikbaarheid controleren…</strong><p data-credential-status></p></div>
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
    <button type="button" data-clear-credentials>Invoer wissen</button></details>`;
  root.append(section);
  const importForm=section.querySelector<HTMLFormElement>('[data-sessionpack]')!;
  const manualForm=section.querySelector<HTMLFormElement>('[data-manual-cookies]')!;
  const fileInput=section.querySelector<HTMLInputElement>('[data-sessionpack-file]')!;
  const passwordInput=section.querySelector<HTMLInputElement>('[data-sessionpack-password]')!;
  const clearButton=section.querySelector<HTMLButtonElement>('[data-clear-credentials]')!;
  const status=section.querySelector<HTMLElement>('[data-credential-status]')!;
  const feedback=section.querySelector<HTMLElement>('[data-credential-feedback]')!;
  const title=section.querySelector<HTMLElement>('[data-credential-title]')!;
  const report=(tone:string,heading:string,message:string,focus=false)=>{
    feedback.dataset.tone=tone;title.textContent=heading;status.textContent=message;
    if(focus)feedback.focus();
  };
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
  clearButton.onclick=()=>{cancel();report('info','Invoer gewist','Een al verstuurde controle kan op de server nog worden afgerond.');};
  const changed=()=>{if(busy){cancel();report('warning','Controle afgebroken','Invoer gewijzigd. Controleer de sessiestatus als de aanvraag al verstuurd was.');}else generation++;};
  section.addEventListener('input',changed);section.addEventListener('change',changed);
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
    if(generation===availabilityGeneration&&isDashboardAdmin())report(available?'info':'warning',available?'Klaar voor import':'Herstel niet beschikbaar',available
      ?`Verwacht botaccount: @${value.botUsername}. Kies een export of vul handmatig vier cookies in.`
      :'Stel eerst directe modus en privéopslag in op de server.');
    updateControls();
  }).catch(()=>{if(generation===availabilityGeneration)report('error','✕ Controle mislukt','Beschikbaarheid ophalen mislukt. Herlaad deze pagina om opnieuw te proberen.');});

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
        report('saving','⏳ Import bezig','Bestand lokaal ontsleutelen… De LIVE wordt pas bij de servercontrole gestopt.');
        if(!file)throw new Error();
        try{cookies=await decryptSessionpack(file,password);}finally{file=undefined;password='';}
      }else{
        cookies=Object.fromEntries([...manualForm.querySelectorAll<HTMLInputElement>('[data-cookie]')]
          .map(field=>[field.dataset.cookie!,field.value.trim()])) as unknown as SessionCookies;
        reset();
      }
      if(!active())return;
      report('saving','⏳ Botaccount controleren','Gedeelde LIVE stoppen; botaccount controleren en privé opslaan…');
      controller=new AbortController();submitted=true;
      const response=await fetch('/api/bot-session',{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'faynominaal'},
        body:JSON.stringify(cookies),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(30_000)])});
      clearSessionCookies(cookies);
      const result=await response.json() as {error?:string;capabilities?:ChatCapabilities};
      if(!active())return;
      if(!response.ok){report('error',importing?'✕ Import mislukt':'✕ Controle mislukt',result.error||'Opslaan niet bevestigd. Controleer de botsessie.',true);return;}
      if(result.capabilities)showChatAccess(result.capabilities);
      report('success',importing?'✓ Import geslaagd':'✓ Botcookies opgeslagen','Botcookies gecontroleerd en privé opgeslagen. Klik op Verbinden om de LIVE te hervatten.',true);
    }catch{
      if(active())report(submitted?'warning':'error',submitted?'⚠ Opslag niet bevestigd':'✕ Import mislukt',submitted
        ?'Geen bevestiging van de server ontvangen. Controleer de sessiestatus voordat je opnieuw probeert.':sessionpackError,true);
    }finally{
      clearSessionCookies(cookies);
      if(current===generation)reset();
      busy=false;controller=undefined;updateControls();
    }
  };
  importForm.onsubmit=event=>{event.preventDefault();void submit(true);};
  manualForm.onsubmit=event=>{event.preventDefault();void submit(false);};
}
