import test from 'node:test';
import assert from 'node:assert/strict';

test('display defaults preserve explicit choices and letter-only mode never creates image requests', async t => {
  const classes = new Set<string>();
  const fields = new Map<string,{checked:boolean;value:string;hidden:boolean;open:boolean;onchange?:()=>void;addEventListener:(name:string,callback:()=>void)=>void}>();
  const saved = new Map<string,string>();
  let imageError: ((event:{target:unknown})=>void)|undefined;
  class Image {
    src='https://p16.tiktokcdn.com/avatar.jpg'; removed=false;
    classList={contains:(value:string)=>value==='user-picture'};
    remove(){this.removed=true;}
  }
  const globals={
    document:{body:{dataset:{},classList:{contains:(name:string)=>classes.has(name),toggle:(name:string,enabled:boolean)=>enabled?classes.add(name):classes.delete(name)}},
      querySelector:(name:string)=>{if(!fields.has(name))fields.set(name,{checked:false,value:'',hidden:false,open:false,addEventListener:()=>{}});return fields.get(name);},
      addEventListener:(name:string,callback:typeof imageError)=>{if(name==='error')imageError=callback;},dispatchEvent:()=>{}},
    localStorage:{getItem:(name:string)=>saved.get(name)??null,setItem:(name:string,value:string)=>saved.set(name,value)},
    HTMLImageElement:Image
  };
  for(const [key,value] of Object.entries(globals)){
    const previous=Object.getOwnPropertyDescriptor(globalThis,key);
    Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
    t.after(()=>{if(previous)Object.defineProperty(globalThis,key,previous);else Reflect.deleteProperty(globalThis,key);});
  }
  const preferences=await import(new URL('../dist/browser/client/preferences.js',import.meta.url).href);
  const identity=await import(new URL('../dist/browser/client/user-identity.js',import.meta.url).href);
  preferences.initializePreferences();
  assert.deepEqual([...classes].sort(),['compact','user-avatars','username-colors']);
  const user={user:'unique_account',displayName:'Friendly <Name>',avatarUrl:'https://p16.tiktokcdn.com/avatar.jpg'};
  assert.equal(identity.displayName(user),'Friendly <Name>');
  assert.equal(identity.displayName({user:'fallback'}),'fallback');
  assert.match(identity.avatarHTML(user),/^F<img/);
  assert.match(identity.avatarHTML(user),/loading="lazy".*decoding="async".*referrerpolicy="no-referrer"/);
  assert.equal(identity.avatarHTML({...user,avatarUrl:'https://evil.example/avatar.jpg'}),'F');
  assert.equal(identity.avatarHTML({...user,avatarUrl:'javascript:alert(1)'}),'F');
  fields.get('#user-avatars')!.checked=false;fields.get('#user-avatars')!.onchange!();
  assert.equal(identity.avatarHTML(user),'F');
  assert.equal(saved.get('fay-user-avatars'),'false');
  saved.set('fay-compact','false');saved.set('fay-username-colors','false');
  preferences.initializePreferences();assert.deepEqual([...classes],[]);
  saved.clear();preferences.initializePreferences();
  identity.initializeUserAvatars();
  const broken=new Image();imageError!({target:broken});
  assert.equal(broken.removed,true);
  assert.equal(identity.avatarHTML(user),'F');
  assert.equal(user.user,'unique_account');
});
