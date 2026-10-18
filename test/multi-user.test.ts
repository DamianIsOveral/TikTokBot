import test from 'node:test';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import type { AddressInfo } from 'node:net';
import {readConfig} from '../src/server/config.ts';
import {createAccessStore} from '../src/server/auth/access-store.ts';
import {ADMIN,MEMBER,createTestApp,signIn,authenticatedFetch} from './auth-fixture.ts';

async function fixture(t: TestContext) {
  const config=readConfig({});
  const access=createAccessStore([ADMIN],undefined,{revision:0,users:[{id:MEMBER,role:'member'}]});
  const app=createTestApp(config,undefined,undefined,access);
  await new Promise<void>(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  config.port=(app.server.address() as AddressInfo).port;
  t.after(()=>app.close());
  const base=`http://127.0.0.1:${config.port}`;
  const admin=authenticatedFetch(await signIn(config,ADMIN));
  const member=authenticatedFetch(await signIn(config,MEMBER));
  const post=(request:typeof fetch,path:string,body?:unknown)=>request(base+path,{method:'POST',
    headers:{Origin:base,'Content-Type':'application/json','X-Requested-With':'faynominaal'},
    body:body===undefined?undefined:JSON.stringify(body)});
  async function stream(request:typeof fetch) {
    const controller=new AbortController();t.after(()=>controller.abort());
    const response=await request(base+'/api/events',{signal:controller.signal});
    const reader=response.body!.getReader();
    let buffer='';
    async function next(type?:string):Promise<Record<string,unknown>|undefined> {
      while(true) {
        while(!buffer.includes('\n\n')) {
          const chunk=await reader.read(); if(chunk.done)return;
          buffer+=new TextDecoder().decode(chunk.value);
        }
        const end=buffer.indexOf('\n\n'); const frame=buffer.slice(0,end);buffer=buffer.slice(end+2);
        if(!frame.startsWith('data: '))continue;
        const event=JSON.parse(frame.slice(6)) as Record<string,unknown>;
        if(!type||event.type===type)return event;
      }
    }
    return {response,next,close:()=>controller.abort()};
  }
  return {base,admin,member,post,stream};
}

test('twee Discordgebruikers slaan tegelijk op: één revisie wint, beiden krijgen de wijzigingsmelding', {timeout:5000},async t=>{
  const f=await fixture(t);
  const a=await f.stream(f.admin),b=await f.stream(f.member);
  await a.next('snapshot'); await b.next('snapshot');
  const command={trigger:'!test',responses:['A'],cooldownSeconds:30,enabled:true};
  const results=await Promise.all([
    f.post(f.admin,'/api/commands',{revision:0,commands:[command]}),
    f.post(f.member,'/api/commands',{revision:0,commands:[{...command,responses:['B']}]})
  ]);
  assert.deepEqual(results.map(result=>result.status).sort(),[200,409]);
  for(const stream of [a,b]) assert.deepEqual(await stream.next('commands-changed'),{type:'commands-changed',revision:1});
  const conflict=await results.find(result=>result.status===409)!.json();
  assert.equal(conflict.currentRevision,1);
  const saved=await (await f.admin(f.base+'/api/commands')).json();
  assert.equal(saved.revision,1);
  assert.equal(saved.commands[0].responses[0],results[0].status===200?'A':'B');
});

test('uitloggen sluit alleen de eigen stream; een andere Discordgebruiker blijft verbonden', {timeout:5000},async t=>{
  const f=await fixture(t);
  const a=await f.stream(f.admin),b=await f.stream(f.member);
  await a.next('snapshot');await b.next('snapshot');
  assert.equal((await f.post(f.admin,'/auth/logout')).status,204);
  assert.equal(await a.next(),undefined);
  const change=f.post(f.member,'/api/commands',{revision:0,commands:[]});
  assert.deepEqual(await b.next('commands-changed'),{type:'commands-changed',revision:1});
  assert.equal((await change).status,200);
  assert.equal((await f.admin(f.base+'/api/commands')).status,401);
});

test('limiet is tien dashboardtabs; sluiten maakt een plaats vrij zonder andere tabs te verstoren', {timeout:5000},async t=>{
  const f=await fixture(t);
  const streams=[];
  for(let i=0;i<10;i++) {
    const stream=await f.stream(i%2?f.admin:f.member);
    assert.equal(stream.response.status,200);await stream.next('snapshot');streams.push(stream);
  }
  const overflow=await f.stream(f.admin);assert.equal(overflow.response.status,503);overflow.close();
  streams[0].close();
  await new Promise<void>(resolve=>setTimeout(resolve,20));
  const replacement=await f.stream(f.member);assert.equal(replacement.response.status,200);await replacement.next('snapshot');
});
