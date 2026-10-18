import type {Diagnostics} from '../shared/diagnostics.js';

export function mountDiagnostics(root:HTMLElement):void {
  const section=document.createElement('section');
  section.innerHTML='<h3>Serverdiagnose</h3><p data-diagnostics role="status">Diagnose laden…</p><button type="button">Diagnose vernieuwen</button>';
  root.append(section);
  const output=section.querySelector<HTMLElement>('[data-diagnostics]')!;
  const button=section.querySelector('button')!;
  async function refresh():Promise<void> {
    button.disabled=true;
    try {
      const response=await fetch('/api/diagnostics');
      if(!response.ok)throw new Error();
      const value=await response.json() as Diagnostics;
      if(!section.isConnected)return;
      output.textContent=`LIVE ontvangen: ${value.readiness.receive?'gereed':'niet verbonden'}. Bot verzenden: ${value.readiness.send?'gereed':'niet gereed'}. `
        +`Proces: ${Math.floor(value.uptimeSeconds/60)} minuten actief, ${value.rssMiB} MiB RAM. Herverbindingen: ${value.live.reconnects}. `
        +`Commands: ${value.commands.matched} herkend, ${value.commands.sent} door de API geaccepteerd, ${value.commands.rateLimited} overgeslagen door limieten, `
        +`${value.commands.roleDenied} zonder toegangsrol, ${value.commands.failed} fouten. `
        +(value.signer?`Signer: ${value.signer.requests} aanvragen, ${value.signer.failures} fouten, p95 ${value.signer.p95Ms??'—'} ms (laatste 100), ${value.signer.starts??0} workerstarts.`:'');
    }catch{output.textContent='Diagnose ophalen mislukt. Controleer de dashboardverbinding.';}
    finally{button.disabled=false;}
  }
  button.onclick=()=>void refresh();void refresh();
}
