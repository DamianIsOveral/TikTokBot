import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import type {AddressInfo} from 'node:net';
import {readConfig} from '../src/server/config.ts';
import {createTestApp,authenticatedFetch,signIn} from './auth-fixture.ts';
import {createCommandStore} from '../src/server/command-store.ts';

test('readiness/diagnostiek vereisen Discord, tonen tellers zonder secrets en veranderen liveness niet',async t=>{
  let connector!:Fake;
  class Fake extends EventEmitter {
    constructor(){super();connector=this;}
    async connect(){}
    async disconnect(){}
    async sendMessage(){}
  }
  const config=readConfig({BOT_ENABLED:'true',EULER_API_KEY:'PRIVATE_KEY',TIKTOK_SESSION_ID:'PRIVATE_SESSION',TIKTOK_TARGET_IDC:'test'});
  const store=createCommandStore(undefined,{revision:0,commands:[{trigger:'!test',responses:['Antwoord'],enabled:true,cooldownSeconds:60}]});
  const app=createTestApp(config,async()=>({TikTokLiveConnection:Fake}),store);
  await new Promise<void>(resolve=>app.server.listen(0,'127.0.0.1',resolve));t.after(()=>app.close());
  config.port=(app.server.address() as AddressInfo).port;
  const base=`http://127.0.0.1:${config.port}`;
  for(const path of ['/api/readiness','/api/diagnostics'])assert.equal((await fetch(base+path)).status,401);
  const request=authenticatedFetch(await signIn(config));
  const before=await (await request(base+'/api/readiness')).json();assert.equal(before.receive,false);assert.equal(before.send,false);
  await request(base+'/api/connect',{method:'POST',headers:{Origin:base,'X-Requested-With':'faynominaal'}});
  await new Promise(resolve=>setImmediate(resolve));
  connector.emit('chat',{content:'!test',user:{uniqueId:'viewer'}});
  await new Promise(resolve=>setTimeout(resolve,10));
  connector.emit('chat',{content:'!test',user:{uniqueId:'other'}});
  const result=await(await request(base+'/api/diagnostics')).json();
  assert.equal(result.readiness.receive,true);assert.equal(result.readiness.send,true);
  assert.equal(result.commands.matched,2);assert.equal(result.commands.sent,1);assert.equal(result.commands.rateLimited,1);
  assert.ok(!/PRIVATE|sessionid|Cookie|room\/chat/.test(JSON.stringify(result)));
  assert.equal((await request(base+'/api/diagnostics',{method:'POST'})).status,405);
  const health=await(await fetch(base+'/health')).json();assert.equal(health.ok,true);
});
