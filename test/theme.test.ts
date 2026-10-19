import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

const source = await readFile(new URL('../public/theme.js',import.meta.url),'utf8');

function fixture(options: {dark?:boolean;saved?:string;blocked?:boolean;loading?:boolean} = {}) {
  const saved = new Map(options.saved ? [['fay-theme',options.saved]] : []);
  const events = new Map<string,(event:Record<string,unknown>)=>void>();
  const documentEvents = new Map<string,()=>void>();
  const selectEvents = new Map<string,()=>void>();
  const select = {value:'system',addEventListener:(type:string,handler:()=>void)=>selectEvents.set(type,handler)};
  const status = {hidden:true,textContent:''};
  const dataset: Record<string,string> = {};
  let mediaChange = () => {};
  const media = {matches:options.dark ?? false,addEventListener:(_type:string,handler:()=>void)=>{mediaChange=handler;}};
  const storage = {
    getItem:(key:string)=>{if(options.blocked)throw new Error('Storage blocked');return saved.get(key)??null;},
    setItem:(key:string,value:string)=>{if(options.blocked)throw new Error('Storage blocked');saved.set(key,value);}
  };
  runInNewContext(source,{
    window:{matchMedia:()=>media,addEventListener:(type:string,handler:(event:Record<string,unknown>)=>void)=>events.set(type,handler)},
    document:{documentElement:{dataset},readyState:options.loading?'loading':'complete',
      querySelectorAll:()=>options.loading?[]:[select],querySelector:()=>status,
      addEventListener:(type:string,handler:()=>void)=>documentEvents.set(type,handler)},localStorage:storage
  });
  return {dataset,saved,select,status,
    system:(dark:boolean)=>{media.matches=dark;mediaChange();},
    choose:(value:string)=>{select.value=value;selectEvents.get('change')!();},
    storage:(value:string|null,key:string|null='fay-theme')=>events.get('storage')!({key,newValue:value}),
    ready:()=>{options.loading=false;documentEvents.get('DOMContentLoaded')!();}
  };
}

test('theme follows the system before paint and on changes, without saving a new default',()=>{
  const light=fixture();assert.equal(light.dataset.theme,'light');
  const dark=fixture({dark:true,loading:true});assert.equal(dark.dataset.theme,'dark');
  assert.equal(dark.saved.size,0);
  dark.ready();assert.equal(dark.select.value,'system');
  dark.system(false);assert.equal(dark.dataset.theme,'light');
});

test('explicit theme survives reload and system changes until system is selected again',()=>{
  const page=fixture({dark:true});page.choose('light');
  assert.equal(page.saved.get('fay-theme'),'light');
  assert.equal(page.dataset.theme,'light');
  page.system(false);page.system(true);assert.equal(page.dataset.theme,'light');
  const reload=fixture({dark:true,saved:page.saved.get('fay-theme')});assert.equal(reload.dataset.theme,'light');
  reload.choose('dark');reload.system(false);assert.equal(reload.dataset.theme,'dark');
  reload.choose('system');assert.equal(reload.dataset.theme,'light');
  reload.system(true);assert.equal(reload.dataset.theme,'dark');
  assert.equal(reload.saved.get('fay-theme'),'system');
});

test('theme ignores invalid values and synchronizes other tabs and cleared preferences',()=>{
  const page=fixture({dark:true,saved:'invalid'});assert.equal(page.dataset.theme,'dark');
  page.storage('light');assert.equal(page.dataset.theme,'light');assert.equal(page.select.value,'light');
  page.storage('dark','unrelated');assert.equal(page.dataset.theme,'light');
  page.storage(null);assert.equal(page.dataset.theme,'dark');assert.equal(page.select.value,'system');
  page.storage('light');page.storage(null,null);assert.equal(page.dataset.theme,'dark');
  page.choose('invalid');assert.equal(page.dataset.theme,'dark');
});

test('blocked local storage still allows switching themes with visible persistence feedback',()=>{
  const page=fixture({dark:true,blocked:true});assert.equal(page.dataset.theme,'dark');
  page.choose('light');assert.equal(page.dataset.theme,'light');
  assert.equal(page.status.hidden,false);assert.match(page.status.textContent,/bewaren/);
  page.choose('system');page.system(false);assert.equal(page.dataset.theme,'light');
});
