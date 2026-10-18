import test from 'node:test';
import assert from 'node:assert/strict';
import {createDirectChat} from '../src/server/tiktok/direct-chat.ts';
import {DirectTikTokError} from '../src/server/tiktok/direct-client.ts';
import {sessionFailure} from '../src/server/tiktok/session-health.ts';
import {signingSdkVersion} from '../src/server/tiktok/signing-profile.ts';

const credentials={botUsername:'bot',sessionId:'PRIVATE_SESSION',targetIdc:'test',msToken:'PRIVATE_TOKEN',verifyFp:'verify_FP'};
const signer=async(input:{url:string;msToken?:string})=>({signedUrl:input.url+`&X-Dynosaur=x&msToken=${input.msToken}&X-Bogus=x&X-Gnarly=x`,signMs:10,rssMiB:64});
test('auth/challenge/429 hebben specifieke sessiestatus en starten geen automatische verificatielus',async()=>{
  for(const [response,state] of [
    [new Response('PRIVATE',{status:401}),'invalid'],[new Response('PRIVATE',{status:403}),'invalid'],
    [new Response('PRIVATE',{status:429}),'rate-limited'],[new Response('PRIVATE',{headers:{'x-tt-verify-id':'PRIVATE'}}),'challenged']
  ] as const){
    let time=100_000;let calls=0;
    const service=createDirectChat(credentials,'host',()=>{},{now:()=>time,createSigner:async()=>signer,
      request:async()=>{calls++;return response.clone();}});
    const value=await service.refresh();assert.equal(value.chat,false);assert.equal(value.session?.state,state);
    time+=600_000;await service.refresh();assert.equal(calls,1);
    assert.ok(!JSON.stringify(value).includes('PRIVATE'));service.close();
  }
  assert.equal(sessionFailure(new DirectTikTokError('signing-context')),'stale');
  assert.equal(sessionFailure(new DirectTikTokError('identity')),'invalid');
});

test('ambigue of geweigerde POST wordt één keer geprobeerd, daarna blokkeren volgende sends en blijft rotatie behouden',async()=>{
  for(const failure of ['403','429','500','empty','malformed','timeout','challenge'] as const){
    let time=100_000;let posts=0;let identities=0;
    const service=createDirectChat(credentials,'host',()=>{},{now:()=>time,createSigner:async()=>signer,
      request:async(input,init)=>{
        if(String(input).includes('/account/info/')){
          identities++;
          if(identities>1)assert.match(new Headers(init?.headers).get('Cookie')!,/msToken=ROTATED/);
          return Response.json({data:{username:'bot',user_id:'123'}},{headers:{'Set-Cookie':'msToken=ROTATED; Max-Age=3600'}});
        }
        if(init?.method==='HEAD')return new Response(null);
        if(init?.method==='POST'){
          posts++;
          if(failure==='timeout')throw new Error('PRIVATE network');
          if(failure==='challenge')return new Response('',{headers:{'x-tt-verify-id':'PRIVATE'}});
          if(failure==='empty')return new Response('');
          if(failure==='malformed')return new Response('<html>PRIVATE</html>');
          return new Response('PRIVATE',{status:Number(failure)});
        }
        return new Response(`<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">${JSON.stringify({__DEFAULT_SCOPE__:{'webapp.app-context':{csrfToken:'PRIVATE',wid:'123456789123456789'}}})}</script><script src="/webmssdk/${signingSdkVersion}/webmssdk.js"></script>`);
      }});
    await service.refresh();
    await assert.rejects(service.send('Offline fakebericht','7300000000000000001',()=>true));
    await assert.rejects(service.send('Niet herhalen','7300000000000000001',()=>true));
    assert.equal(posts,1);assert.equal(service.canSend(),false);
    time+=600_000;await service.refresh();assert.equal(identities,1);
    await service.refresh(true);assert.equal(identities,2);assert.equal(service.canSend(),true);
    const stats=service.diagnostics();assert.equal(stats.requests,1);assert.equal(stats.p95Ms,10);
    assert.ok(!/PRIVATE|ROTATED/.test(JSON.stringify({stats,value:service.snapshot()})));service.close();
  }
});

test('authfout uit moderatie pauzeert ook chat; een geweigerde moderator-doelactie laat de sessie intact',async()=>{
  const service=createDirectChat(credentials,'host',()=>{},{createSigner:async()=>signer,
    request:async()=>Response.json({data:{username:'bot',user_id:'123'}})});
  await service.refresh();
  await assert.rejects(service.withModeration(async()=>{throw new DirectTikTokError('target-role',200,50003);}));
  assert.equal(service.canSend(),true);
  await assert.rejects(service.withModeration(async()=>{throw new DirectTikTokError('rejected',403);}));
  assert.equal(service.canSend(),false);assert.equal(service.snapshot().session?.state,'invalid');service.close();
});
