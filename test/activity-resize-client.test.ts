import test from 'node:test';
import type {TestContext} from 'node:test';
import assert from 'node:assert/strict';

type Input = {key?:string;button?:number;pointerId?:number;clientY?:number;shiftKey?:boolean;preventDefault:()=>void};
type Handler = (event:Input) => void;

class Node {
  id: string;
  children: Node[] = [];
  parentElement: Node | null = null;
  hidden = false;
  focused = false;
  clientWidth = 800;
  clientHeight = 600;
  height = 0;
  dataset: Record<string,string> = {};
  styles: Record<string,string> = {display:'flex'};
  properties = new Map<string,string>();
  attributes = new Map<string,string>();
  captures = new Set<number>();
  listeners = new Map<string,Handler[]>();
  classes = new Set<string>();
  classList = {add:(name:string)=>this.classes.add(name),remove:(name:string)=>this.classes.delete(name)};
  style = {setProperty:(name:string,value:string)=>this.properties.set(name,value)};
  constructor(id:string,height=0) {this.id=id;this.height=height;}
  append(...nodes:Node[]) {
    for (const node of nodes) {
      if (node.parentElement) node.parentElement.children.splice(node.parentElement.children.indexOf(node),1);
      this.children.push(node);node.parentElement=this;
    }
  }
  getBoundingClientRect() {return {height:this.height};}
  setAttribute(name:string,value:string) {this.attributes.set(name,value);}
  addEventListener(name:string,callback:Handler) {this.listeners.set(name,[...(this.listeners.get(name)||[]),callback]);}
  fire(name:string,input:Partial<Input>={}) {
    for (const callback of this.listeners.get(name)||[]) callback({preventDefault:()=>{},...input});
  }
  focus() {this.focused=true;}
  setPointerCapture(id:number) {this.captures.add(id);}
  hasPointerCapture(id:number) {return this.captures.has(id);}
  releasePointerCapture(id:number) {this.captures.delete(id);this.fire('lostpointercapture');}
}

async function fixture(t:TestContext,requested=220) {
  const columns = new Node('chatpage');columns.dataset.activity='review';
  const chat = new Node('chat-panel');
  const review = new Node('review-panel');
  review.styles={display:'flex',paddingTop:'10px',paddingBottom:'10px',rowGap:'8px'};
  const heading = new Node('heading',40);
  const tabs = new Node('tabs',30);
  const feed = new Node('reviews',96);
  const recent = new Node('recent-moderation',26);
  const separator = new Node('activity-resize',12);
  const activity = new Node('activity-panel');
  activity.styles={display:'flex',paddingTop:'8px',borderTopWidth:'1px'};
  const activityHeading = new Node('activity-heading',26);
  const filters = new Node('filters',20);
  const activityFeed = new Node('activity-feed',32);
  review.append(heading,tabs,feed,recent,separator,activity);
  activity.append(activityHeading,filters,activityFeed);
  columns.append(chat,review);
  const body = new Node('body');
  const documentNode = new Node('document');
  const resizeCallbacks: (()=>void)[] = [];
  const observed: Node[] = [];
  const globals = {
    document:{body,addEventListener:documentNode.addEventListener.bind(documentNode)},
    getComputedStyle:(node:Node)=>node.styles,
    ResizeObserver:class {
      constructor(callback:()=>void) {resizeCallbacks.push(callback);}
      observe(node:Node) {observed.push(node);}
    }
  };
  for (const [name,value] of Object.entries(globals)) {
    const original = Object.getOwnPropertyDescriptor(globalThis,name);
    Object.defineProperty(globalThis,name,{value,writable:true,configurable:true});
    t.after(()=>{if(original)Object.defineProperty(globalThis,name,original);else Reflect.deleteProperty(globalThis,name);});
  }
  const commits:number[] = [];
  const module = await import(new URL('../dist/browser/client/activity-resize.js',import.meta.url).href);
  const {update} = module.initializeActivityResize({columns,chat,review,separator,activity,
    getHeight:()=>requested,setHeight:(height:number)=>{requested=height;},persist:()=>commits.push(requested)});
  update();
  const current = () => Number(separator.attributes.get('aria-valuenow'));
  const minimum = () => Number(separator.attributes.get('aria-valuemin'));
  const maximum = () => Number(separator.attributes.get('aria-valuemax'));
  return {columns,chat,review,heading,tabs,feed,recent,separator,activity,activityHeading,filters,activityFeed,body,observed,
    commits,update,current,minimum,maximum,requested:()=>requested,resize:()=>resizeCallbacks.forEach(callback=>callback()),
    chrome:()=>documentNode.fire('workspace-chrome-changed')};
}

test('activity splitter reserves both feeds and all visible fixed chrome with bounded integer ARIA',async t=>{
  const f=await fixture(t,800);
  assert.equal(f.maximum(),336);
  assert.equal(f.minimum(),87);
  assert.equal(f.current(),336);
  assert.equal(f.activity.properties.get('--activity-size'),'336px');
  assert.equal(f.activity.properties.get('--activity-min-size'),'87px');
  assert.equal(f.requested(),800);
  assert.equal(f.commits.length,0);
  f.review.clientHeight=600.4;f.heading.height=40.8;f.update();
  assert.equal(f.maximum(),335);
  assert.ok(f.current()>=f.minimum() && f.current()<=f.maximum());
  assert.equal(Number.isInteger(f.current()),true);
  assert.equal(f.separator.attributes.get('aria-valuetext'),'LIVE-activiteit 335 pixels');
});

test('keyboard resize, shifted steps, limits and resets persist requested height',async t=>{
  const f=await fixture(t);
  f.separator.fire('keydown',{key:'ArrowUp'});assert.equal(f.requested(),230);
  f.separator.fire('keydown',{key:'ArrowDown',shiftKey:true});assert.equal(f.requested(),200);
  f.separator.fire('keydown',{key:'End'});assert.equal(f.requested(),336);
  f.separator.fire('keydown',{key:'ArrowUp'});assert.equal(f.requested(),336);
  f.separator.fire('keydown',{key:'Home'});assert.equal(f.requested(),87);
  f.separator.fire('keydown',{key:'Enter'});assert.equal(f.requested(),220);
  f.separator.fire('keydown',{key:'ArrowDown'});assert.equal(f.requested(),210);
  f.separator.fire('dblclick');assert.equal(f.requested(),220);
  const commits=f.commits.length;
  f.separator.fire('keydown',{key:'ArrowRight'});assert.equal(f.commits.length,commits);
});

test('pointer drag grows activity upward and commits only on matching release',async t=>{
  const f=await fixture(t);
  f.separator.fire('pointerdown',{button:2,pointerId:1,clientY:300});assert.equal(f.separator.captures.size,0);
  f.separator.fire('pointerdown',{button:0,pointerId:1,clientY:300});
  assert.equal(f.separator.focused,true);assert.equal(f.body.classes.has('resizing-activity'),true);
  f.separator.fire('pointermove',{pointerId:2,clientY:250});assert.equal(f.requested(),220);
  f.separator.fire('pointermove',{pointerId:1,clientY:250});assert.equal(f.requested(),270);
  f.separator.fire('pointerup',{pointerId:2});assert.equal(f.commits.length,0);
  f.separator.fire('pointermove',{pointerId:1,clientY:2000});assert.equal(f.requested(),87);
  f.separator.fire('pointermove',{pointerId:1,clientY:0});assert.equal(f.requested(),336);
  assert.equal(f.commits.length,0);
  f.separator.fire('pointerup',{pointerId:1});assert.deepEqual(f.commits,[336]);
  assert.equal(f.separator.captures.size,0);assert.equal(f.body.classes.has('resizing-activity'),false);
});

test('Escape, pointer cancellation and unexpected lost capture restore even a previously clamped request',async t=>{
  const f=await fixture(t,700);
  for (const cancel of ['escape','pointercancel','lostpointercapture']) {
    f.separator.fire('pointerdown',{button:0,pointerId:3,clientY:300});
    f.separator.fire('pointermove',{pointerId:3,clientY:330});assert.equal(f.requested(),306);
    if (cancel==='escape') f.separator.fire('keydown',{key:'Escape'});
    else f.separator.fire(cancel,{pointerId:3});
    assert.equal(f.requested(),700);assert.equal(f.current(),336);
    assert.equal(f.separator.captures.size,0);assert.equal(f.commits.length,0);
  }
});

test('reparent, hidden activity and unavailable workspace cancel safely without writing preferences',async t=>{
  const f=await fixture(t);
  for (const destination of ['chat','bottom','hidden','page']) {
    f.columns.dataset.activity='review';f.review.append(f.separator,f.activity);f.activity.hidden=false;f.columns.clientWidth=800;f.update();
    f.separator.fire('pointerdown',{button:0,pointerId:4,clientY:300});
    f.separator.fire('pointermove',{pointerId:4,clientY:280});assert.equal(f.requested(),240);
    if (destination==='chat') {f.chat.append(f.separator,f.activity);f.columns.dataset.activity='chat';}
    if (destination==='bottom') {f.columns.append(f.separator,f.activity);f.columns.dataset.activity='bottom';}
    if (destination==='hidden') f.activity.hidden=true;
    if (destination==='page') f.columns.clientWidth=0;
    f.update();assert.equal(f.requested(),220);assert.equal(f.separator.captures.size,0);
    assert.equal(f.separator.hidden,destination!=='chat');
    assert.equal(f.commits.length,0);
  }
  f.columns.clientWidth=800;f.columns.dataset.activity='column';f.activity.hidden=false;f.update();
  f.separator.fire('keydown',{key:'Enter'});f.separator.fire('dblclick');
  assert.equal(f.separator.hidden,true);assert.equal(f.commits.length,0);
});

test('chrome and size changes preserve requested height, protect tiny feeds and do not observe feedback loops',async t=>{
  const f=await fixture(t,500);
  assert.ok(f.observed.includes(f.filters));assert.ok(f.observed.includes(f.recent));
  assert.equal(f.observed.includes(f.activity),false);assert.equal(f.observed.includes(f.activityFeed),false);
  assert.equal(f.observed.includes(f.feed),false);
  f.review.clientHeight=900;f.resize();assert.equal(f.current(),500);
  f.filters.height=120;f.review.fire('toggle');assert.equal(f.minimum(),187);
  f.recent.height=126;f.resize();assert.equal(f.maximum(),536);
  f.recent.hidden=true;f.chrome();assert.equal(f.maximum(),670);
  f.review.clientHeight=240;f.resize();
  assert.equal(f.maximum(),187);assert.equal(f.minimum(),187);assert.equal(f.current(),187);
  assert.equal(f.requested(),500);assert.equal(f.commits.length,0);
  f.review.clientHeight=900;f.resize();assert.equal(f.current(),500);
  f.columns.dataset.activity='bottom';f.columns.append(f.separator,f.activity);f.update();assert.equal(f.separator.hidden,true);
  f.columns.dataset.activity='review';f.review.append(f.separator,f.activity);f.update();assert.equal(f.current(),500);
  assert.equal(f.commits.length,0);
});
