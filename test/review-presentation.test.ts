import test from 'node:test';
import assert from 'node:assert/strict';

test('review presentation follows density, preserves overrides and saves recent summary independently',async t=>{
  class Field {
    checked=false;value='';hidden=false;open=false;onchange?:()=>void;
    listeners=new Map<string,()=>void>();
    addEventListener(name:string,callback:()=>void){this.listeners.set(name,callback);}
  }
  const fields=new Map<string,Field>();
  const saved=new Map<string,string>();
  const classes=new Set<string>();
  const dataset:Record<string,string>={};
  let events=0;
  const globals={
    document:{body:{dataset,classList:{contains:(name:string)=>classes.has(name),toggle:(name:string,value:boolean)=>value?classes.add(name):classes.delete(name)}},
      querySelector:(name:string)=>{if(!fields.has(name))fields.set(name,new Field());return fields.get(name);},
      dispatchEvent:()=>{events++;}},
    localStorage:{getItem:(key:string)=>saved.get(key)??null,setItem:(key:string,value:string)=>saved.set(key,value)}
  };
  for(const [key,value] of Object.entries(globals)){
    const previous=Object.getOwnPropertyDescriptor(globalThis,key);
    Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
    t.after(()=>{if(previous)Object.defineProperty(globalThis,key,previous);else Reflect.deleteProperty(globalThis,key);});
  }
  const {initializePreferences}=await import(new URL('../dist/browser/client/preferences.js',import.meta.url).href);
  initializePreferences();
  assert.equal(dataset.reviewActions,'compact');
  assert.equal(fields.get('#recent-moderation')!.open,false);
  const density=fields.get('#compact-mode')!;
  density.checked=false;density.onchange!();assert.equal(dataset.reviewActions,'full');
  const actions=fields.get('#review-actions-mode')!;
  actions.value='menu';actions.onchange!();
  density.checked=true;density.onchange!();assert.equal(dataset.reviewActions,'menu');
  initializePreferences();assert.equal(actions.value,'menu');assert.equal(dataset.reviewActions,'menu');
  const visible=fields.get('#recent-moderation-toggle')!;
  visible.checked=false;visible.onchange!();
  const recent=fields.get('#recent-moderation')!;
  assert.equal(recent.hidden,true);
  recent.open=true;recent.listeners.get('toggle')!();
  initializePreferences();assert.equal(recent.hidden,true);assert.equal(recent.open,true);
  assert.equal(events,2);
  assert.equal(saved.get('fay-recent-moderation-open'),'true');
  saved.set('fay-review-actions','invalid');initializePreferences();
  assert.equal(actions.value,'auto');assert.equal(dataset.reviewActions,'compact');
});

test('review toolbar keeps all actions and permissions while preserving selected timeout on rerender',async t=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'window');
  Object.defineProperty(globalThis,'window',{configurable:true,writable:true,value:{addEventListener:()=>{}}});
  t.after(()=>{if(previous)Object.defineProperty(globalThis,'window',previous);else Reflect.deleteProperty(globalThis,'window');});
  const {state}=await import(new URL('../dist/browser/client/model.js',import.meta.url).href);
  const {actionButtons}=await import(new URL('../dist/browser/client/render.js',import.meta.url).href);
  state.liveMode=false;
  const message={id:7,user:'viewer"<test>',text:'sample',time:'12:00',resolved:false,reviewDuration:300};
  let html=actionButtons(message);
  assert.match(html,/class="actions review-actions"/);
  for(const action of ['mute','ban','mute-ban','ignore']) assert.match(html,new RegExp(`data-action="${action}"`));
  assert.match(html,/value="300" selected/);
  assert.match(html,/data-menu="7"[^>]*aria-label="Alle acties voor @viewer&quot;&lt;test&gt;"/);
  assert.match(html,/Dempen · demo/);
  assert.doesNotMatch(html,/ disabled/);
  html=actionButtons({...message,reviewDuration:-1});assert.match(html,/value="30" selected/);
  state.liveMode=true;state.serverConnected=false;
  html=actionButtons(message);
  assert.match(html,/data-action="mute"[^>]*disabled/);
  assert.match(html,/data-action="ban"[^>]*disabled/);
  assert.match(html,/data-action="mute-ban"[^>]*disabled/);
  assert.doesNotMatch(html,/data-action="ignore"[^>]*disabled/);
  assert.match(html,/action-unavailable/);
  assert.doesNotMatch(html,/class="review-menu"[^>]*disabled/);
});
