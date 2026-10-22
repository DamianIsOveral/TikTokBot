import test from 'node:test';
import assert from 'node:assert/strict';

class Menu {
  open=false;
  focused=false;
  handlers=new Map<string,(event:any)=>void>();
  summary={focus:()=>{this.focused=true;}};
  addEventListener(name:string,handler:(event:any)=>void){this.handlers.set(name,handler);}
  querySelector(selector:string){assert.equal(selector,'summary');return this.summary;}
}

test('all three toolbar menus keep inside clicks, close outside in capture, and return focus on Escape',async t=>{
  const menus=[new Menu(),new Menu(),new Menu()];
  let outside:(event:any)=>void=()=>{};
  const document={querySelectorAll:(selector:string)=>{
    assert.equal(selector,'.display-preferences,#layout-options,.test-options');return menus;
  },addEventListener:(name:string,handler:(event:any)=>void,options:unknown)=>{
    assert.equal(name,'click');assert.deepEqual(options,{capture:true});outside=handler;
  }};
  const original=Object.getOwnPropertyDescriptor(globalThis,'document');
  Object.defineProperty(globalThis,'document',{configurable:true,value:document});
  t.after(()=>{if(original)Object.defineProperty(globalThis,'document',original);else Reflect.deleteProperty(globalThis,'document');});
  const {initializeToolbarMenus}=await import(new URL('../dist/browser/client/layout.js',import.meta.url).href);
  initializeToolbarMenus();
  for(const menu of menus){
    for(const other of menus)other.open=true;
    menu.handlers.get('toggle')!({});
    assert.deepEqual(menus.map(other=>other.open),menus.map(other=>other===menu));
    outside({composedPath:()=>[{},menu,document]});assert.equal(menu.open,true);
    outside({composedPath:()=>[{},document]});assert.equal(menu.open,false);assert.equal(menu.focused,false);
    menu.open=true;let prevented=false;
    menu.handlers.get('keydown')!({key:'Enter',preventDefault:()=>{prevented=true;}});assert.equal(menu.open,true);
    menu.handlers.get('keydown')!({key:'Escape',preventDefault:()=>{prevented=true;}});
    assert.equal(menu.open,false);assert.equal(prevented,true);assert.equal(menu.focused,true);
  }
});
