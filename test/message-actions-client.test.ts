import test from 'node:test';
import assert from 'node:assert/strict';

test('message menu restores only confirmed restrictions and submits no remote list request', async t => {
  class Node {
    innerHTML = '';
    textContent = '';
    isConnected = true;
    open = false;
    disabled = false;
    dataset: Record<string,string> = {};
    listeners = new Map<string,(event: {target:Node})=>void>();
    classList = {add:()=>{},remove:()=>{}};
    style: Record<string,string> = {};
    setAttribute() {}
    addEventListener(name: string, handler: (event: {target:Node})=>void) { this.listeners.set(name,handler); }
    matches() { return this.open; }
    showPopover() { this.open=true; }
    hidePopover() { this.open=false; }
    contains() { return false; }
    getBoundingClientRect() { return {width:280,height:320}; }
    querySelector() { return null; }
    querySelectorAll() { return []; }
    closest() { return this; }
  }
  const menu = new Node();
  const toast = new Node();
  let elapsed = 0;
  let confirmation = true;
  let partial = false;
  const globals = {
    Element:Node,innerWidth:1280,innerHeight:900,performance:{now:()=>elapsed},window:{confirm:()=>confirmation},
    document:{createElement:()=>menu,body:{append:()=>{}},querySelector:(selector:string)=>selector==='#toast'?toast:null,
      querySelectorAll:()=>[],activeElement:null},
    setTimeout:()=>1,clearTimeout:()=>{}
  };
  for (const [key,value] of Object.entries(globals)) {
    const original = Object.getOwnPropertyDescriptor(globalThis,key);
    Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
    t.after(()=>{if(original)Object.defineProperty(globalThis,key,original);else Reflect.deleteProperty(globalThis,key);});
  }
  const {state}=await import(new URL('../dist/browser/client/model.js',import.meta.url).href);
  const feedback=await import(new URL('../dist/browser/client/moderation-feedback.js',import.meta.url).href);
  const {createMessageActions}=await import(new URL('../dist/browser/client/message-actions.js',import.meta.url).href);
  state.liveMode=true;state.serverConnected=true;state.phase='connected';
  state.messages=[{id:1,user:'canonical_viewer',displayName:'Visible Viewer',userId:'456',secUid:'SEC_VIEWER',resolved:false,text:'Chat',time:'12:00'}];
  const rights={connected:true,enabled:true,mute:true,ban:true,reason:''};
  state.moderation=rights;
  const record={userId:'456',name:'canonical_viewer',action:'ban',status:'accepted',at:new Date(1000).toISOString()};
  let entries=[record];
  const posts: Record<string,unknown>[]=[];
  const requests:string[]=[];
  const snapshot=()=>({roomId:'room-a',serverNow:1000+elapsed,entries});
  t.mock.method(globalThis,'fetch',async (input: Parameters<typeof fetch>[0],init?: RequestInit)=>{
    requests.push(String(input));
    if(init?.method==='POST') {
      const body=JSON.parse(String(init.body));
      posts.push(body);
      entries=[{...record,action:body.action}];
      if (body.action==='mute-ban') {
        entries=partial ? [{...record,action:'mute'}] : [{...record,action:'mute'},{...record,action:'ban'}];
        if (partial) return Response.json({...rights,moderation:snapshot(),partial:true,completed:['mute'],
          error:'Demping is door de API geaccepteerd; blokkeren is niet bevestigd.'},{status:502});
      }
    }
    return Response.json({...rights,moderation:snapshot()});
  });
  feedback.applyModerationFeedback(snapshot());
  const actions=createMessageActions(()=>{});
  const open=()=>actions.open(1,{x:1200,y:800});
  const click=async (action:string)=>{
    const button=new Node();button.dataset.menuAction=action;
    menu.listeners.get('click')!({target:button});
    await new Promise<void>(resolve=>setImmediate(resolve));
  };
  await open();
  assert.match(menu.innerHTML,/Visible Viewer/);
  assert.match(menu.innerHTML,/@canonical_viewer/);
  assert.match(menu.innerHTML,/data-menu-action="unban"/);
  assert.doesNotMatch(menu.innerHTML,/data-menu-action="ban"/);
  await click('unban');
  assert.deepEqual(posts,[{action:'unban',targetId:'456',recorded:true}]);
  await open();
  assert.match(menu.innerHTML,/data-menu-action="ban"/);
  assert.doesNotMatch(menu.innerHTML,/data-menu-action="unban"/);
  entries=[{...record,action:'mute',expiresAt:6000} as typeof record];
  elapsed=1000;feedback.applyModerationFeedback(snapshot());
  assert.match(menu.innerHTML,/data-menu-action="unmute"/);
  await click('unmute');
  assert.deepEqual(posts[1],{action:'unmute',targetId:'456',recorded:true});
  entries=[{...record,action:'mute',expiresAt:6000} as typeof record];
  elapsed=2000;await open();
  elapsed=5000;await click('unmute');
  assert.equal(posts.length,2);
  assert.match(menu.innerHTML,/data-menu-action="mute-menu"/);
  entries=[{...record,status:'uncertain'}];
  elapsed=6000;await open();
  assert.doesNotMatch(menu.innerHTML,/data-menu-action="unban"/);
  entries=[];elapsed=6500;await open();
  assert.match(menu.innerHTML,/data-menu-action="mute-ban-menu"/);
  await click('mute-ban-menu');
  assert.match(menu.innerHTML,/Eerst dempen, daarna blokkeren/);
  assert.match(menu.innerHTML,/data-menu-action="mute-ban:5"/);
  confirmation=false;await click('mute-ban:5');
  assert.equal(posts.length,2);
  confirmation=true;await click('mute-ban:5');
  assert.deepEqual(posts[2],{action:'mute-ban',messageId:1,duration:5});
  assert.equal(state.messages[0].resolved,true);
  assert.equal(feedback.confirmedRestriction('456','ban'),true);
  assert.equal(feedback.confirmedRestriction('456','mute'),true);
  state.messages[0].resolved=false;
  entries=[];elapsed=6700;await open();
  await click('mute-ban-menu');partial=true;await click('mute-ban:30');
  assert.equal(posts.length,4);
  assert.equal(state.messages[0].resolved,false);
  assert.equal(feedback.confirmedRestriction('456','mute'),true);
  assert.equal(feedback.confirmedRestriction('456','ban'),false);
  assert.match(toast.textContent,/blokkeren is niet bevestigd/);
  entries=[record];
  elapsed=6900;await open();
  state.moderation={...rights,ban:false};
  elapsed=7000;feedback.applyModerationFeedback(snapshot());
  await click('unban');
  assert.equal(posts.length,4);
  assert.match(menu.innerHTML,/data-menu-action="unban"[\s\S]*?disabled/);
  state.moderation=rights;
  state.serverConnected=false;elapsed=8000;feedback.applyModerationFeedback(snapshot());
  assert.doesNotMatch(menu.innerHTML,/data-menu-action="unban"/);
  assert.ok(requests.every(url=>url==='/api/moderation'));
});
