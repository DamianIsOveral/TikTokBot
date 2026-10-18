import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {AddressInfo} from 'node:net';
import {createTestApp,signIn,authenticatedFetch,ADMIN,MEMBER} from './auth-fixture.ts';
import {createAccessStore} from '../src/server/auth/access-store.ts';
import {readConfig} from '../src/server/config.ts';
import {loadSessionState} from '../src/server/tiktok/session-state.ts';
import {createDirectChat} from '../src/server/tiktok/direct-chat.ts';
import {incomingChat} from '../src/server/incoming-chat.ts';
import {usernameColor} from '../src/shared/username-color.ts';

const env={BOT_ENABLED:'true',EULER_API_KEY:'KEY',TIKTOK_CHAT_TRANSPORT:'direct',TIKTOK_SESSION_ID:'OLD',TIKTOK_TARGET_IDC:'test',TIKTOK_MS_TOKEN:'TOKEN',TIKTOK_VERIFY_FP:'verify_FP'};
const replacement={sessionId:'NEW',targetIdc:'newidc',msToken:'NEW_TOKEN',verifyFp:'verify_NEW'};
test('alleen Discordadmin kan herstel doen, API geeft nooit cookies terug en herstart gebruikt nieuwe waarden',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'fay-repair-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const config=readConfig(env);const path=join(dir,'state.json');const state=await loadSessionState(path,config.directCredentials!);
  let gets=0;
  const app=createTestApp(config,undefined,undefined,createAccessStore([ADMIN],undefined,{revision:0,users:[{id:MEMBER,role:'member'}]}),undefined,{
    sessionState:state,createSigner:async()=>async()=>{throw new Error('Geen signing nodig');},request:async(_input,init)=>{
      gets++;assert.equal(init?.method,'GET');return Response.json({data:{username:config.botUsername,user_id:'123'}});
    }});
  await new Promise<void>(resolve=>app.server.listen(0,'127.0.0.1',resolve));t.after(()=>app.close());config.port=(app.server.address() as AddressInfo).port;
  const base=`http://127.0.0.1:${config.port}`;const url=base+'/api/bot-session';
  assert.equal((await fetch(url)).status,401);
  const member=authenticatedFetch(await signIn(config,MEMBER));assert.equal((await member(url)).status,403);
  const admin=authenticatedFetch(await signIn(config));
  const post=(body:unknown,origin=base)=>admin(url,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Requested-With':'faynominaal'},body:JSON.stringify(body)});
  assert.equal((await post(replacement,'https://evil.invalid')).status,403);
  assert.equal((await post({...replacement,botUsername:'another'})).status,400);
  assert.equal((await post({...replacement,sessionId:'bad;value'})).status,400);
  const result=await post(replacement);assert.equal(result.status,200);
  const publicResult=await result.text();assert.ok(!/NEW_TOKEN|verify_NEW|sessionId/.test(publicResult));
  assert.equal((await post(replacement)).status,429);
  const restored=await loadSessionState(path,config.directCredentials!);
  assert.equal(restored.jar.cookies.get('sessionid'),'NEW');assert.equal(restored.jar.cookies.get('msToken'),'NEW_TOKEN');
  assert.ok(gets>=2);
});
test('verkeerd account of ingetrokken toestemming bewaart geen nieuwe cookies',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'fay-rejected-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const creds=readConfig(env).directCredentials!;const path=join(dir,'state.json');const state=await loadSessionState(path,creds);
  state.jar.absorb(new Headers({'Set-Cookie':'msToken=ROTATED'}));await state.flush();const before=await readFile(path,'utf8');
  let wrong=false;let authorized=true;
  const service=createDirectChat(creds,'streamer',()=>{},{sessionState:state,createSigner:async()=>async()=>{throw new Error();},
    request:async()=>{if(!wrong)authorized=false;return Response.json({data:{username:wrong?'another':creds.botUsername,user_id:'123'}});}});
  await service.refresh();authorized=true;wrong=true;
  await assert.rejects(service.replaceSession({...replacement,botUsername:creds.botUsername},()=>true));assert.equal(await readFile(path,'utf8'),before);
  wrong=false;authorized=true;
  await assert.rejects(service.replaceSession({...replacement,botUsername:creds.botUsername},()=>authorized));assert.equal(await readFile(path,'utf8'),before);service.close();
});
test('modrollen komen uit TikTokmetadata en kleuren zijn stabiel en begrensd',()=>{
  assert.equal(incomingChat({userIdentity:{isModeratorOfAnchor:true}},'bot').isModerator,true);
  assert.equal(incomingChat({user:{userAttr:{isAdmin:true}}},'bot').isModerator,true);
  assert.equal(incomingChat({user:{nickname:'Moderator'}},'bot').isModerator,false);
  assert.equal(incomingChat({user:{badgeList:[{sceneType:1}]}},'bot').isModerator,true);
  assert.equal(incomingChat({user:{badgeList:[{sceneType:4}]}},'bot').isModerator,false);
  assert.equal(usernameColor('@Zeffuro'),usernameColor('zeffuro'));
  for(const name of ['abc','😀','<script>','BOT',''])assert.ok(usernameColor(name)>=0&&usernameColor(name)<12);
});

test('ontbrekende signer of opslagfout houdt cookieherstel geblokkeerd en behoudt de vorige jar',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'fay-repair-fail-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const creds=readConfig(env).directCredentials!;const state=await loadSessionState(join(dir,'state.json'),creds);
  const unavailable=createDirectChat(creds,'streamer',()=>{},{sessionState:state,createSigner:async()=>{throw new Error();}});
  await unavailable.refresh();await assert.rejects(unavailable.replaceSession({...replacement,botUsername:creds.botUsername},()=>true));unavailable.close();
  const oldJar=state.jar;
  const service=createDirectChat(creds,'streamer',()=>{},{sessionState:{...state,flush:async()=>{throw new Error('PRIVATE');}},
    createSigner:async()=>async()=>{throw new Error();},request:async()=>Response.json({data:{username:creds.botUsername,user_id:'123'}})});
  await service.refresh();
  await assert.rejects(service.replaceSession({...replacement,botUsername:'wrong'},()=>true));
  await assert.rejects(service.replaceSession({...replacement,botUsername:creds.botUsername},()=>true));
  assert.equal(state.jar,oldJar);assert.equal(state.jar.cookies.get('sessionid'),'OLD');assert.equal(service.canSend(),false);service.close();
});
