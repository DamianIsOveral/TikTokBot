import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const fixture=await readFile(new URL('./fixtures/session-lantern.synthetic.sessionpack',import.meta.url));
const password='  synthetic café 🔑 fixture  ';
const expected={sessionId:'fixture-session-value',targetIdc:'fixture-region-value',msToken:'fixture-token-value',verifyFp:'fixture-fingerprint-value'};
const turn=()=>new Promise<void>(resolve=>setImmediate(resolve));
async function until(predicate:()=>boolean){const start=Date.now();while(!predicate()){if(Date.now()-start>10000)throw new Error('Client did not settle');await turn();}}
class Field {
  value='';disabled=false;files:unknown[]=[];dataset:Record<string,string>={};
}
class Form {
  onsubmit:((event:{preventDefault:()=>void})=>void)|null=null;
  fields:Field[];
  constructor(fields:Field[]){this.fields=fields;}
  reset(){for(const field of this.fields){field.value='';field.files=[];}}
  querySelectorAll(){return this.fields;}
  submit(){this.onsubmit?.({preventDefault:()=>{}});}
}

test('credential import only submits verified browser plaintext after explicit action and clears all input',async t=>{
  let admin=true;let capabilities=0;let availabilityResolve:(value:Response)=>void=()=>{};
  let postResolve:((value:Response)=>void)|undefined;
  let postReject:((error:Error)=>void)|undefined;
  const posts:RequestInit[]=[];
  const permissionHandlers:(()=>void)[]=[];
  let disconnected:()=>void=()=>{};
  let section:any;
  const createSection=()=>{
    const file=new Field(),secret=new Field(),cookies=Object.keys(expected).map(key=>Object.assign(new Field(),{dataset:{cookie:key}}));
    const importing=new Form([file,secret]),manual=new Form(cookies),buttons=[{disabled:true},{disabled:true}];
    const status={textContent:''},title={textContent:''},feedback={dataset:{tone:''},focused:false,focus(){this.focused=true;}},clear={onclick:null as (()=>void)|null},listeners=new Map<string,()=>void>();
    const selectors:Record<string,unknown>={'[data-sessionpack]':importing,'[data-manual-cookies]':manual,'[data-sessionpack-file]':file,
      '[data-sessionpack-password]':secret,'[data-clear-credentials]':clear,'[data-credential-status]':status,'[data-credential-title]':title,'[data-credential-feedback]':feedback};
    return {innerHTML:'',isConnected:true,file,secret,cookies,importing,manual,buttons,status,title,feedback,clear,listeners,
      querySelector:(selector:string)=>selectors[selector],querySelectorAll:(selector:string)=>selector==='input'?[file,secret,...cookies]:buttons,
      addEventListener:(name:string,callback:()=>void)=>listeners.set(name,callback),remove(){this.isConnected=false;}};
  };
  const globals={
    __credentialsTest:{isDashboardAdmin:()=>admin,showChatAccess:()=>{capabilities++;}},
    MutationObserver:class {constructor(callback:()=>void){disconnected=callback;}observe(){}disconnect(){}},
    document:{createElement:()=>{section=createSection();return section;},addEventListener:(_name:string,handler:()=>void)=>permissionHandlers.push(handler),removeEventListener:()=>{}},
    fetch:async(_url:string,init?:RequestInit)=>{
      if(init?.method!=='POST')return new Promise<Response>(resolve=>{availabilityResolve=resolve;});
      posts.push(init);
      return new Promise<Response>((resolve,reject)=>{postResolve=resolve;postReject=reject;});
    }
  };
  for(const [key,value] of Object.entries(globals)){
    const original=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
    t.after(()=>{if(original)Object.defineProperty(globalThis,key,original);else Reflect.deleteProperty(globalThis,key);});
  }
  let source=await readFile(new URL('../dist/browser/client/credentials.js',import.meta.url),'utf8');
  source=source.replace(/import \{ isDashboardAdmin \} from '\.\/auth.js';/,'const {isDashboardAdmin}=globalThis.__credentialsTest;')
    .replace(/import \{ showChatAccess \} from '\.\/capabilities.js';/,'const {showChatAccess}=globalThis.__credentialsTest;')
    .replace("'./sessionpack.js'",JSON.stringify(new URL('../dist/browser/client/sessionpack.js',import.meta.url).href));
  const {mountCredentials}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  const root={append:()=>{}};admin=false;mountCredentials(root);assert.equal(Boolean(section),false);admin=true;mountCredentials(root);
  assert.match(section.innerHTML,/href="https:\/\/github.com\/Zeffuro\/SessionLantern\/releases" target="_blank" rel="noopener noreferrer"/);
  const select=(value:unknown={size:fixture.length,arrayBuffer:async()=>Uint8Array.from(fixture).buffer},secret=password)=>{
    section.file.files=[value];section.secret.value=secret;section.listeners.get('change')();
  };
  select();section.importing.submit();assert.equal(posts.length,0);
  availabilityResolve(Response.json({available:true,botUsername:'test_bot'}));await until(()=>!section.buttons[0].disabled);
  assert.equal(posts.length,0);section.importing.submit();section.manual.submit();
  assert.ok(section.buttons.every((button:any)=>button.disabled));assert.equal(section.secret.value,'');assert.deepEqual(section.file.files,[]);
  await until(()=>posts.length===1);assert.deepEqual(JSON.parse(String(posts[0].body)),expected);
  assert.doesNotMatch(String(posts[0].body),/synthetic|ciphertext|exportedAt|kdf/);
  assert.equal((posts[0].headers as Record<string,string>)['X-Requested-With'],'faynominaal');
  postResolve!(Response.json({capabilities:{chat:true}}));await until(()=>!section.buttons[0].disabled);assert.equal(capabilities,1);
  assert.match(section.status.textContent,/privé opgeslagen/);assert.ok(section.cookies.every((field:Field)=>field.value===''));
  assert.equal(section.feedback.dataset.tone,'success');assert.equal(section.title.textContent,'✓ Import geslaagd');assert.equal(section.feedback.focused,true);

  for(const [value,secret] of [[{size:65537,arrayBuffer:()=>{throw new Error('must not read');}},password],[{size:fixture.length,arrayBuffer:async()=>Uint8Array.from(fixture).buffer},'short'],[{size:fixture.length,arrayBuffer:async()=>Uint8Array.from(fixture).buffer},'wrong synthetic passphrase']] as const){
    select(value,secret);section.importing.submit();await until(()=>!section.buttons[0].disabled);
    assert.equal(posts.length,1);assert.match(section.status.textContent,/Bestand of exportwachtwoord ongeldig/);assert.equal(section.secret.value,'');
    assert.equal(section.feedback.dataset.tone,'error');assert.equal(section.title.textContent,'✕ Import mislukt');
  }

  let release:(value:ArrayBuffer)=>void=()=>{};
  select({size:fixture.length,arrayBuffer:()=>new Promise<ArrayBuffer>(resolve=>{release=resolve;})});section.importing.submit();
  section.clear.onclick();assert.ok(section.buttons[0].disabled);section.manual.submit();section.secret.value='new input';release(Uint8Array.from(fixture).buffer);
  await until(()=>!section.buttons[0].disabled);assert.equal(posts.length,1);assert.equal(section.secret.value,'new input');assert.match(section.title.textContent,/Invoer gewist/);
  select({size:fixture.length,arrayBuffer:()=>new Promise<ArrayBuffer>(resolve=>{release=resolve;})});section.importing.submit();
  section.listeners.get('input')();release(Uint8Array.from(fixture).buffer);await new Promise(resolve=>setTimeout(resolve,300));assert.equal(posts.length,1);

  for(const field of section.cookies)field.value='manual-cookie';section.manual.submit();await until(()=>posts.length===2);
  postResolve!(Response.json({error:'Niet het ingestelde botaccount'},{status:400}));await until(()=>!section.buttons[0].disabled);
  assert.equal(capabilities,1);assert.match(section.status.textContent,/Niet het ingestelde botaccount/);assert.ok(section.cookies.every((field:Field)=>field.value===''));
  assert.equal(section.feedback.dataset.tone,'error');assert.equal(section.title.textContent,'✕ Controle mislukt');
  select();section.importing.submit();await until(()=>posts.length===3);const pending=postResolve!;
  section.clear.onclick();const clearStatus=section.status.textContent;pending(Response.json({capabilities:{chat:true}}));await turn();await turn();
  await until(()=>!section.buttons[0].disabled);assert.equal(section.status.textContent,clearStatus);assert.equal(capabilities,1);

  select();section.importing.submit();await until(()=>posts.length===4);postReject!(new Error('synthetic connection lost'));
  await until(()=>!section.buttons[0].disabled);assert.equal(section.feedback.dataset.tone,'warning');
  assert.equal(section.title.textContent,'⚠ Opslag niet bevestigd');assert.match(section.status.textContent,/Controleer de sessiestatus/);
  assert.equal(capabilities,1);

  select({size:fixture.length,arrayBuffer:()=>new Promise<ArrayBuffer>(resolve=>{release=resolve;})});section.importing.submit();
  admin=false;permissionHandlers.forEach(handler=>handler());release(Uint8Array.from(fixture).buffer);
  await new Promise(resolve=>setTimeout(resolve,300));assert.equal(posts.length,4);assert.equal(section.isConnected,false);assert.equal(section.secret.value,'');
  admin=true;section.secret.value='detached secret';disconnected();assert.equal(section.secret.value,'');
});
