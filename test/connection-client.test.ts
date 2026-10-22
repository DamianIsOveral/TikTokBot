import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

class Dialog {
  innerHTML='';className='';open=false;removed=false;
  handlers=new Map<string,(event:{preventDefault:()=>void})=>void>();
  cancel={onclick:()=>{}};stop={onclick:()=>{}};
  querySelector(selector:string){return selector==='[data-cancel]'?this.cancel:this.stop;}
  setAttribute(){}
  addEventListener(name:string,handler:(event:{preventDefault:()=>void})=>void){this.handlers.set(name,handler);}
  showModal(){this.open=true;}
  close(){this.open=false;}
  remove(){this.removed=true;}
}
test('shared stop requires confirmation and current role, prevents duplicate requests, and recovers after failure',async t=>{
  const button={disabled:false,onclick:undefined as undefined|(()=>Promise<void>)};
  const toasts:string[]=[],dialogs:Dialog[]=[],posts:{url:string;init:RequestInit}[]=[];
  let allowed=false,refreshes=0;
  let resolve:(value:Response)=>void=()=>{};
  const globals={
    __stopTest:{canManageBot:()=>allowed,checkSession:async()=>true,element:()=>button,toast:(text:string)=>toasts.push(text)},
    document:{createElement:()=>{const dialog=new Dialog();dialogs.push(dialog);return dialog;},body:{append:()=>{}}},
    fetch:(url:string,init:RequestInit)=>{posts.push({url,init});return new Promise<Response>(done=>{resolve=done;});}
  };
  for(const [key,value] of Object.entries(globals)){
    const original=Object.getOwnPropertyDescriptor(globalThis,key);
    Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
    t.after(()=>{if(original)Object.defineProperty(globalThis,key,original);else Reflect.deleteProperty(globalThis,key);});
  }
  let source=await readFile(new URL('../dist/browser/client/connection.js',import.meta.url),'utf8');
  source=source.replace(/^import .* from '\.\/auth.js';/m,'const {canManageBot,checkSession}=globalThis.__stopTest;')
    .replace(/^import .* from '\.\/dom.js';/m,'const {element,toast}=globalThis.__stopTest;');
  const {createConnection,initializeStopButton}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  const connection=createConnection(()=>{});
  initializeStopButton(()=>connection.stop(),()=>{refreshes++;button.disabled=!allowed;});
  await button.onclick!();assert.equal(dialogs.length,0);assert.equal(posts.length,0);
  allowed=true;const cancelled=button.onclick!();const first=dialogs.at(-1)!;
  assert.equal(first.open,true);assert.match(first.innerHTML,/alle dashboardgebruikers/);assert.match(first.innerHTML,/autofocus>Annuleren/);
  await button.onclick!();assert.equal(dialogs.length,1);
  first.cancel.onclick();await cancelled;assert.equal(posts.length,0);assert.equal(first.removed,true);
  const escaped=button.onclick!();let prevented=false;
  dialogs.at(-1)!.handlers.get('cancel')!({preventDefault:()=>{prevented=true;}});await escaped;
  assert.equal(prevented,true);assert.equal(posts.length,0);
  const demoted=button.onclick!();allowed=false;dialogs.at(-1)!.stop.onclick();await demoted;assert.equal(posts.length,0);
  allowed=true;const stopping=button.onclick!();dialogs.at(-1)!.stop.onclick();await Promise.resolve();
  assert.equal(button.disabled,true);await button.onclick!();assert.equal(posts.length,1);
  assert.equal(posts[0].url,'/api/stop');assert.equal(posts[0].init.method,'POST');
  assert.equal((posts[0].init.headers as Record<string,string>)['X-Requested-With'],'faynominaal');
  resolve(new Response(null,{status:202}));await stopping;
  assert.equal(button.disabled,false);assert.equal(refreshes,4);assert.equal(toasts.length,0);
  const failed=button.onclick!();dialogs.at(-1)!.stop.onclick();await Promise.resolve();resolve(new Response(null,{status:503}));await failed;
  assert.equal(button.disabled,false);assert.equal(refreshes,5);assert.match(toasts[0],/Stoppen mislukt/);
  const last=button.onclick!();dialogs.at(-1)!.stop.onclick();await Promise.resolve();allowed=false;resolve(new Response(null,{status:202}));await last;
  assert.equal(button.disabled,true);assert.equal(refreshes,6);
});
