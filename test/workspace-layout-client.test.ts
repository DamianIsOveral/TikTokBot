import test from 'node:test';
import type {TestContext} from 'node:test';
import assert from 'node:assert/strict';

type Event = {target?:Node;key?:string;button?:number;pointerId?:number;clientX?:number;
  shiftKey?:boolean;preventDefault:()=>void};
type Handler = (event:Event)=>void;

class Node {
  id = '';
  children:Node[] = [];
  parentElement:Node | null = null;
  dataset:Record<string,string> = {};
  attributes = new Map<string,string>();
  classes = new Set<string>();
  properties = new Map<string,string>();
  listeners = new Map<string,Handler[]>();
  captures = new Set<number>();
  value = '';
  textContent = '';
  hidden = false;
  open = false;
  disabled = false;
  min = '';
  max = '';
  clientWidth = 1400;
  clientHeight = 420;
  offsetWidth = 12;
  scrollTop = 0;
  rect = {left:0,top:100,width:280,height:400};
  focused = false;
  onclick?:Handler;
  onchange?:Handler;
  oninput?:Handler;
  classList = {
    add:(name:string)=>{this.classes.add(name);},
    remove:(name:string)=>{this.classes.delete(name);},
    toggle:(name:string,force?:boolean)=>{
      const on = force ?? !this.classes.has(name);
      if (on) this.classes.add(name);else this.classes.delete(name);
      return on;
    },
    contains:(name:string)=>this.classes.has(name)
  };
  style = {setProperty:(name:string,value:string)=>{this.properties.set(name,value);}};
  append(...nodes:Node[]) {
    for (const node of nodes) {
      if (node.parentElement) {
        const siblings = node.parentElement.children;
        siblings.splice(siblings.indexOf(node),1);
      }
      node.parentElement = this;
      this.children.push(node);
    }
  }
  replaceChildren(...nodes:Node[]) {
    for (const child of this.children) child.parentElement = null;
    this.children = [];
    this.append(...nodes);
  }
  setAttribute(name:string,value:string) {this.attributes.set(name,value);}
  addEventListener(name:string,handler:Handler) {
    this.listeners.set(name,[...(this.listeners.get(name)||[]),handler]);
  }
  fire(name:string,detail:Partial<Event> = {}) {
    const event = {target:this,preventDefault:()=>{},...detail};
    const direct = name === 'change' ? this.onchange : name === 'input' ? this.oninput : name === 'click' ? this.onclick : undefined;
    direct?.(event);
    for (const handler of this.listeners.get(name)||[]) handler(event);
  }
  focus() {this.focused=true;}
  getBoundingClientRect() {return this.rect;}
  setPointerCapture(id:number) {this.captures.add(id);}
  hasPointerCapture(id:number) {return this.captures.has(id);}
  releasePointerCapture(id:number) {this.captures.delete(id);}
}

async function fixture(t:TestContext,options:{saved?:string;legacy?:string;width?:number;blocked?:boolean;hidden?:boolean} = {}) {
  const nodes = new Map<string,Node>();
  const get = (selector:string) => {
    const node = nodes.get(selector);
    assert.ok(node,`Missing fixture element ${selector}`);
    return node;
  };
  for (const selector of ['#chatpage','#chat-panel','#review-panel','#activity-panel','#activity-resize','#chat-resize','#layout-status',
    '#layout-preset','#layout-reset','#toast','header','.demo','#layout-mode','#layout-visible','#layout-order',
    '#layout-stack-first','#layout-activity','#layout-share','#layout-chat-height','#layout-review-height',
    '#layout-activity-height','#layout-activity-width','#layout-options','#layout-options>summary','#layout-close','.display-preferences']) nodes.set(selector,new Node());
  for (const field of ['share','chat-height','review-height','activity-height','activity-width']) {
    nodes.set(`output[for="layout-${field}"]`,new Node());
  }
  const columns = get('#chatpage');
  const chat = get('#chat-panel');
  const review = get('#review-panel');
  const activity = get('#activity-panel');
  const separator = get('#chat-resize');
  columns.clientWidth=options.width ?? 1400;
  const main = new Node();main.append(columns);
  columns.append(chat,separator,review);review.append(get('#activity-resize'),activity);
  activity.hidden=options.hidden ?? false;
  const chatMessage = new Node();chatMessage.textContent='Existing chat message';chat.append(chatMessage);
  const reviewButton = new Node();reviewButton.textContent='Existing review action';review.append(reviewButton);
  const filter = new Node();filter.value='gift';activity.append(filter);
  const storage = new Map<string,string>();
  if (options.saved !== undefined) storage.set('fay-workspace-layout',options.saved);
  if (options.legacy !== undefined) storage.set('fay-chat-split',options.legacy);
  const writes:string[] = [];
  const resizeCallbacks:(()=>void)[] = [];
  const mutations:(()=>void)[] = [];
  const windowListeners = new Map<string,()=>void>();
  const observed:Node[] = [];
  const body = new Node();
  const globals = {
    document:{querySelector:(selector:string)=>nodes.get(selector) ?? null,body,addEventListener:()=>{}},
    window:{innerHeight:900,scrollY:0,addEventListener:(name:string,handler:()=>void)=>windowListeners.set(name,handler)},
    localStorage:{
      getItem:(name:string)=>{if(options.blocked)throw new Error('Storage denied');return storage.get(name) ?? null;},
      setItem:(name:string,value:string)=>{if(options.blocked)throw new Error('Storage denied');storage.set(name,value);writes.push(value);}
    },
    getComputedStyle:()=>({marginLeft:'12px'}),
    ResizeObserver:class {
      constructor(callback:()=>void) {resizeCallbacks.push(callback);}
      observe(node:Node) {observed.push(node);}
    },
    MutationObserver:class {
      constructor(callback:()=>void) {mutations.push(callback);}
      observe(node:Node,config:unknown) {assert.equal(node,activity);assert.deepEqual(config,{attributes:true,attributeFilter:['hidden']});}
    },
    setTimeout:()=>1,clearTimeout:()=>{}
  };
  for (const [name,value] of Object.entries(globals)) {
    const original = Object.getOwnPropertyDescriptor(globalThis,name);
    Object.defineProperty(globalThis,name,{configurable:true,writable:true,value});
    t.after(()=>{if(original)Object.defineProperty(globalThis,name,original);else Reflect.deleteProperty(globalThis,name);});
  }
  const {initializeWorkspace} = await import(new URL('../dist/browser/client/workspace-layout.js',import.meta.url).href);
  initializeWorkspace();
  const change = (field:string,value:string) => {const node=get(`#layout-${field}`);node.value=value;node.fire('change');};
  const input = (field:string,value:number) => {const node=get(`#layout-${field}`);node.value=String(value);node.fire('input');node.fire('change');};
  return {get,columns,chat,review,activity,separator,main,body,filter,chatMessage,reviewButton,storage,writes,observed,
    change,input,resize:()=>resizeCallbacks.forEach(callback=>callback()),mutation:()=>mutations.forEach(callback=>callback()),
    windowResize:()=>windowListeners.get('resize')?.(),saved:()=>JSON.parse(storage.get('fay-workspace-layout')!)};
}

test('workspace keeps separate desktop and stacked orders and preserves live panel contents',async t=>{
  const f=await fixture(t,{saved:JSON.stringify({order:'review',stackFirst:'chat',activity:'chat'})});
  let actions=0;
  f.reviewButton.addEventListener('click',()=>actions++);
  f.filter.addEventListener('change',()=>actions++);
  assert.deepEqual(f.columns.children,[f.review,f.separator,f.chat]);
  assert.equal(f.activity.parentElement,f.chat);
  f.change('mode','stacked');
  assert.equal(f.columns.dataset.flow,'stacked');
  assert.deepEqual(f.columns.children,[f.chat,f.separator,f.review]);
  f.change('stack-first','review');
  f.change('mode','columns');
  f.change('order','chat');
  assert.deepEqual(f.columns.children,[f.chat,f.separator,f.review]);
  f.columns.clientWidth=700;f.resize();
  assert.deepEqual(f.columns.children,[f.review,f.separator,f.chat]);
  assert.equal(f.get('#layout-order').value,'chat');
  assert.equal(f.get('#layout-stack-first').value,'review');
  assert.equal(f.chatMessage.parentElement,f.chat);
  assert.equal(f.reviewButton.parentElement,f.review);
  assert.equal(f.filter.parentElement,f.activity);
  assert.equal(f.filter.value,'gift');
  f.reviewButton.fire('click');f.filter.fire('change');
  assert.equal(actions,2);
  for (const node of [f.columns,f.get('header'),f.get('.demo')]) assert.ok(f.observed.includes(node));
  assert.equal(f.get('#activity-resize').parentElement,f.chat);
});

test('layout menu can be dismissed without changing settings and does not overlap display preferences',async t=>{
  const f=await fixture(t);
  const menu=f.get('#layout-options');
  const display=f.get('.display-preferences');
  menu.open=true;display.open=true;menu.fire('toggle');
  assert.equal(display.open,false);
  f.get('#layout-close').fire('click');
  assert.equal(menu.open,false);assert.equal(f.get('#layout-options>summary').focused,true);
  menu.open=true;menu.fire('keydown',{key:'Escape'});assert.equal(menu.open,false);
  menu.open=true;display.open=true;display.fire('toggle');assert.equal(menu.open,false);
  assert.equal(f.writes.length,0);
});

test('activity always follows the visible panel and reparents the same live node',async t=>{
  const f=await fixture(t);
  let changes=0;f.filter.addEventListener('change',()=>changes++);
  f.change('visible','chat');
  assert.equal(f.columns.dataset.flow,'single');
  assert.equal(f.review.classList.contains('layout-hidden'),true);
  assert.equal(f.activity.parentElement,f.chat);
  assert.equal(f.get('#layout-activity').value,'review');
  f.change('visible','review');f.change('activity','chat');
  assert.equal(f.activity.parentElement,f.review);
  assert.equal(f.get('#activity-resize').parentElement,f.review);
  assert.equal(f.chat.classList.contains('layout-hidden'),true);
  f.change('activity','bottom');
  assert.equal(f.activity.parentElement,f.columns);
  assert.equal(f.columns.children.at(-1),f.activity);
  f.change('visible','both');f.change('activity','review');
  assert.equal(f.activity.parentElement,f.review);
  assert.equal(f.columns.children.includes(f.activity),false);
  assert.equal(f.filter.value,'gift');f.filter.fire('change');assert.equal(changes,1);
});

test('activity show/hide observes cached preferences and column placement falls back with usable controls',async t=>{
  const f=await fixture(t,{saved:JSON.stringify({mode:'columns',activity:'column',split:61})});
  assert.equal(f.columns.dataset.activity,'column');
  assert.equal(f.get('#layout-activity-width').disabled,false);
  assert.equal(f.get('#layout-activity-height').disabled,true);
  f.activity.hidden=true;f.mutation();
  assert.equal(f.columns.dataset.activity,'none');
  assert.equal(f.get('#layout-activity-width').disabled,true);
  f.storage.set('fay-workspace-layout',JSON.stringify({activity:'chat',split:20}));
  f.activity.hidden=false;f.mutation();
  assert.equal(f.columns.dataset.activity,'column');
  assert.equal(f.get('#layout-share').value,'61');
  assert.equal(f.activity.parentElement,f.columns);
  f.columns.clientWidth=1179;f.resize();
  assert.equal(f.columns.dataset.flow,'columns');
  assert.equal(f.columns.dataset.activity,'bottom');
  assert.equal(f.get('#layout-activity-height').disabled,false);
  assert.match(f.get('#layout-status').textContent,/derde kolom/);
  assert.equal(f.get('#layout-activity-width').disabled,true);
  f.columns.clientWidth=1180;f.windowResize();
  assert.equal(f.columns.dataset.activity,'column');
  f.change('mode','stacked');
  assert.equal(f.columns.dataset.activity,'bottom');
  assert.equal(f.get('#layout-share').disabled,true);
  assert.equal(f.get('#layout-chat-height').disabled,false);
  assert.equal(f.get('#layout-review-height').disabled,false);
  assert.equal(f.writes.length,1);
});

test('saved settings, legacy split migration, reset and presets persist independently of layout clamping',async t=>{
  const f=await fixture(t,{legacy:'67',width:1000});
  assert.equal(f.get('#layout-share').value,'67');
  assert.equal(f.columns.dataset.flow,'columns');
  assert.equal(f.writes.length,0);
  f.input('chat-height',655);
  assert.equal(f.saved().split,67);
  assert.equal(f.saved().chatHeight,655);
  assert.equal(f.columns.properties.get('--chat-height'),'655px');
  f.change('preset','three');
  assert.equal(f.saved().mode,'columns');
  assert.equal(f.saved().activity,'column');
  f.change('preset','invalid');
  assert.equal(f.writes.length,2);
  f.get('#layout-reset').fire('click');
  assert.deepEqual(f.saved(),{mode:'auto',visible:'both',order:'chat',stackFirst:'chat',activity:'review',split:53,
    chatHeight:480,reviewHeight:420,activityHeight:220,activityWidth:280});
  assert.equal(f.get('#layout-preset').value,'');
  assert.equal(f.storage.get('fay-chat-split'),'67');
});

test('malformed, partial and blocked storage remain usable',async t=>{
  for (const saved of ['{invalid','null','[]',JSON.stringify({mode:'invalid',split:'75',chatHeight:Infinity})]) {
    await t.test(saved,async sub=>{
      const f=await fixture(sub,{saved,legacy:'77'});
      assert.equal(f.get('#layout-share').value,'53');
      assert.equal(f.get('#layout-mode').value,'auto');
      f.change('order','review');assert.equal(f.saved().order,'review');
    });
  }
  await t.test('partial saved object overrides legacy and clamps ranges',async sub=>{
    const f=await fixture(sub,{saved:JSON.stringify({split:500,activityWidth:1,reviewHeight:555.7}),legacy:'77'});
    assert.equal(f.get('#layout-share').value,'80');
    assert.equal(f.get('#layout-activity-width').value,'220');
    assert.equal(f.get('#layout-review-height').value,'556');
    assert.equal(f.get('#layout-mode').value,'auto');
  });
  await t.test('blocked storage reports persistence failure after applying selection',async sub=>{
    const f=await fixture(sub,{blocked:true});
    f.change('visible','chat');
    assert.equal(f.columns.dataset.flow,'single');
    assert.equal(f.review.classList.contains('layout-hidden'),true);
    assert.match(f.get('#toast').textContent,/kon niet worden bewaard/);
    assert.equal(f.writes.length,0);
  });
});

test('keyboard resizing respects reversed order, actual track bounds and unavailable layouts',async t=>{
  const f=await fixture(t,{saved:JSON.stringify({mode:'columns',order:'review',activity:'column',activityWidth:480}),width:1180});
  f.activity.rect.width=480;f.resize();
  const available=1180-12-480-12;
  const minimum=300/available*100;
  const assertAccessibleValue=()=>{
    const current=Number(f.separator.attributes.get('aria-valuenow'));
    assert.ok(current>=Number(f.separator.attributes.get('aria-valuemin')));
    assert.ok(current<=Number(f.separator.attributes.get('aria-valuemax')));
  };
  f.separator.fire('keydown',{key:'ArrowRight'});
  assert.equal(f.saved().split,51);
  f.separator.fire('keydown',{key:'ArrowLeft',shiftKey:true});
  assert.equal(f.saved().split,100-minimum);
  f.separator.fire('keydown',{key:'Home'});
  assert.equal(f.saved().split,100-minimum);
  assertAccessibleValue();
  f.separator.fire('keydown',{key:'End'});
  assert.equal(f.saved().split,minimum);
  assertAccessibleValue();
  assert.equal(f.columns.properties.get('--first-share'),`${100-minimum}fr`);
  f.separator.fire('keydown',{key:'Enter'});assert.equal(f.saved().split,53);
  f.change('mode','stacked');
  const writes=f.writes.length;
  f.separator.fire('keydown',{key:'ArrowRight'});
  assert.equal(f.writes.length,writes);
});

test('pointer cancellation restores the prior split without saving and layout transitions end capture',async t=>{
  const f=await fixture(t,{saved:JSON.stringify({split:60})});
  f.columns.rect.left=100;
  f.separator.fire('pointerdown',{button:2,pointerId:1});assert.equal(f.separator.captures.size,0);
  f.separator.fire('pointerdown',{button:0,pointerId:1});
  assert.equal(f.separator.focused,true);
  assert.equal(f.body.classList.contains('resizing-chat'),true);
  f.separator.fire('pointermove',{pointerId:2,clientX:300});assert.equal(f.get('#layout-share').value,'60');
  f.separator.fire('pointermove',{pointerId:1,clientX:600});assert.notEqual(f.get('#layout-share').value,'60');
  f.separator.fire('pointercancel',{pointerId:1});
  assert.equal(f.get('#layout-share').value,'60');
  assert.equal(f.separator.captures.size,0);
  assert.equal(f.body.classList.contains('resizing-chat'),false);
  assert.equal(f.writes.length,0);
  f.separator.fire('pointerdown',{button:0,pointerId:3});
  f.separator.fire('pointermove',{pointerId:3,clientX:900});
  f.columns.clientWidth=700;f.resize();
  assert.equal(f.get('#layout-share').value,'60');
  assert.equal(f.separator.captures.size,0);
  assert.equal(f.writes.length,0);
  f.columns.clientWidth=1400;f.resize();
  f.separator.fire('pointerdown',{button:0,pointerId:4});
  f.separator.fire('pointermove',{pointerId:4,clientX:900});
  f.separator.fire('pointerup',{pointerId:4});
  assert.equal(f.writes.length,1);
  assert.ok(f.saved().split>55 && f.saved().split<60);
});

test('hidden page startup defers geometry and applies preferences when the workspace becomes visible',async t=>{
  const f=await fixture(t,{width:0,saved:JSON.stringify({order:'review',split:65,activity:'bottom'})});
  assert.equal(f.get('#layout-share').value,'65');
  assert.equal(f.columns.dataset.flow,undefined);
  assert.equal(f.columns.properties.has('--workspace-height'),false);
  f.columns.clientWidth=1400;f.main.scrollTop=25;f.resize();
  assert.deepEqual(f.columns.children,[f.review,f.separator,f.chat,f.get('#activity-resize'),f.activity]);
  assert.equal(f.columns.dataset.activity,'bottom');
  assert.equal(f.columns.properties.get('--workspace-height'),'759px');
  assert.equal(f.writes.length,0);
});
