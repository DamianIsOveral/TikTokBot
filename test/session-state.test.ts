import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,stat,mkdir,chmod,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadSessionState,SessionStateError} from '../src/server/tiktok/session-state.ts';
import {createDirectClient} from '../src/server/tiktok/direct-client.ts';
import {createDirectChat} from '../src/server/tiktok/direct-chat.ts';

const credentials={botUsername:'bot',sessionId:'BOOTSTRAP',targetIdc:'test',msToken:'TOKEN',verifyFp:'verify_FP'};
async function fixture(t:{after:(fn:()=>Promise<void>)=>void}) {
  const directory=await mkdtemp(join(tmpdir(),'fay-session-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  return join(directory,'session.json');
}
test('cookie-rotatie overleeft volledig nieuwe client/service en schrijft alleen bij wijziging',async t=>{
  const path=await fixture(t);let time=100_000;
  const store=await loadSessionState(path,credentials,()=>time);
  await store.flush();await assert.rejects(stat(path));
  store.jar.absorb(new Headers({'Set-Cookie':'msToken=ROTATED; Max-Age=3600'}));
  await Promise.all([store.flush(),store.flush()]);
  const before=await readFile(path,'utf8');time+=1000;await store.flush();
  assert.equal(await readFile(path,'utf8'),before);
  if(process.platform!=='win32')assert.equal((await stat(path)).mode&0o777,0o600);
  const restarted=await loadSessionState(path,{verifyFp:credentials.verifyFp,msToken:credentials.msToken,targetIdc:credentials.targetIdc,
    sessionId:credentials.sessionId,botUsername:credentials.botUsername},()=>time);
  let calls=0;
  const service=createDirectChat(credentials,'streamer',()=>{},{sessionState:restarted,now:()=>time,
    createSigner:async()=>async input=>({signedUrl:input.url,signMs:0,rssMiB:0}),request:async(_input,init)=>{
      calls++;assert.match(new Headers(init?.headers).get('Cookie')!,/msToken=ROTATED(?:;|$)/);
      return Response.json({data:{username:'bot',user_id_str:'123',user_id:'123'}});
    }});
  const access=await service.refresh();
  assert.equal(calls,1);assert.equal(access.chat,true);assert.equal(access.session?.persistent,true);
  assert.equal(service.botUserId(),'123');
  assert.ok(!/ROTATED|BOOTSTRAP|TOKEN/.test(JSON.stringify(access)));
  service.close();
});

test('expiry en expliciete verwijdering overleven herstarts zonder terugval naar oude env-cookies',async t=>{
  const path=await fixture(t);let time=100_000;
  const store=await loadSessionState(path,credentials,()=>time);
  const headers=new Headers();headers.append('Set-Cookie','msToken=SHORT; Max-Age=1');headers.append('Set-Cookie','sessionid=; Max-Age=0');
  store.jar.absorb(headers);await store.flush();time+=2000;
  const restarted=await loadSessionState(path,credentials,()=>time);
  assert.equal(restarted.jar.cookies.has('msToken'),false);assert.equal(restarted.jar.cookies.has('sessionid'),false);
  await restarted.flush();
  const again=await loadSessionState(path,credentials,()=>time);
  assert.equal(again.jar.cookies.has('msToken'),false);assert.equal(again.jar.cookies.has('sessionid'),false);
  let calls=0;
  const client=createDirectClient(credentials,async()=>{calls++;return Response.json({});},{cookieJar:again.jar,flushCookies:again.flush});
  await assert.rejects(client.verifyIdentity());assert.equal(calls,0);
  const fresh=await loadSessionState(path,{...credentials,sessionId:'NEW_BOOTSTRAP'},()=>time);
  assert.equal(fresh.jar.cookies.get('sessionid'),'NEW_BOOTSTRAP');assert.equal(fresh.jar.cookies.get('msToken'),'TOKEN');
  const other=await loadSessionState(path,{...credentials,botUsername:'other'},()=>time);
  assert.equal(other.jar.cookies.get('sessionid'),'BOOTSTRAP');
});

test('beschadigde of te grote state wordt geweigerd zonder cookie, inhoud of pad in de fout',async t=>{
  const path=await fixture(t);
  for(const text of ['PRIVATE_COOKIE','x'.repeat(128*1024+1),JSON.stringify({version:2}),JSON.stringify({version:1,cookies:{unknown:{value:'SECRET'}}})]){
    await writeFile(path,text,{mode:0o600});
    await assert.rejects(loadSessionState(path,credentials),error=>{
      assert.ok(error instanceof SessionStateError);assert.ok(!/PRIVATE|SECRET|session\.json/.test(error.message));return true;
    });
  }
  const source=await loadSessionState(path+'.valid',credentials);
  source.jar.absorb(new Headers({'Set-Cookie':'msToken=ROTATED'}));await source.flush();
  const valid=JSON.parse(await readFile(path+'.valid','utf8'));
  for(const cookies of [{unknown:{value:'SECRET'}},{msToken:{value:'bad;cookie'}},{msToken:{value:''}},
    {msToken:{value:'TOKEN',expires:null}},{msToken:{value:'TOKEN',extra:true}},[]]){
    await writeFile(path,JSON.stringify({...valid,cookies}),{mode:0o600});
    await assert.rejects(loadSessionState(path,credentials),SessionStateError);
  }
});

test('POSIX weigert voor anderen leesbare sessiestate en symbolische links',{skip:process.platform==='win32'},async t=>{
  const path=await fixture(t);const state=await loadSessionState(path,credentials);
  state.jar.absorb(new Headers({'Set-Cookie':'msToken=ROTATED'}));await state.flush();
  await chmod(path,0o644);await assert.rejects(loadSessionState(path,credentials),SessionStateError);
  await chmod(path,0o600);await symlink(path,path+'.link');
  await assert.rejects(loadSessionState(path+'.link',credentials),SessionStateError);
});

test('opslagfalen na ontvangen rotatie blokkeert verdere requests met een vaste fout',async t=>{
  const path=await fixture(t);
  const store=await loadSessionState(path,credentials);
  await mkdir(path);
  let calls=0;
  const client=createDirectClient(credentials,async()=>{calls++;return Response.json({data:{username:'bot',user_id:'123'}},
    {headers:{'Set-Cookie':'msToken=ROTATED; Max-Age=3600'}});},{cookieJar:store.jar,flushCookies:store.flush});
  await assert.rejects(client.verifyIdentity(),error=>{assert.ok(!String(error).includes('PRIVATE'));return true;});
  assert.equal(calls,1);
  await assert.rejects(client.verifyIdentity());assert.equal(calls,1);
});
