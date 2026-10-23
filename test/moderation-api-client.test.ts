import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

test('HTML, empty, malformed and network responses report only safe metadata and never retry a moderation write',async t=>{
  const client=await import(new URL('../dist/browser/client/moderation-api.js',import.meta.url).href);
  const privateBody='<!DOCTYPE html>PRIVATE_COOKIE PRIVATE_USERNAME';
  const cases=[
    ()=>new Response(privateBody,{status:502,headers:{'Content-Type':'text/html'}}),
    ()=>new Response(privateBody,{headers:{'Content-Type':'text/html'}}),
    ()=>new Response('',{status:403,headers:{'Content-Type':'application/json'}}),
    ()=>new Response(privateBody,{headers:{'Content-Type':'application/json'}}),
    ()=>Response.json(null),()=>Response.json([]),()=>Response.json({}),
    ()=>{throw new Error(privateBody);}
  ];
  for(const makeResponse of cases){
    const calls:{path:string;init:RequestInit}[]=[];
    const fetch=t.mock.method(globalThis,'fetch',async(input:Parameters<typeof globalThis.fetch>[0],init:RequestInit)=>{
      calls.push({path:String(input),init});
      if(String(input)==='/api/moderation/errors')throw new Error('Reporter unavailable PRIVATE_COOKIE');
      return makeResponse();
    });
    await assert.rejects(async()=>{
      const reply=await client.requestModeration('/api/moderation','mute',{action:'mute',messageId:1,duration:30});
      client.validateModerationReply(reply,reply.value.accepted===true);
    },(error:unknown)=>{
      assert.ok(error instanceof Error);assert.match(error.message,/uitkomst is niet bevestigd/);
      assert.match(error.message,/Controleer het moderatielog of TikTok/);assert.match(error.message,/referentie [0-9a-f-]{36}/);
      assert.doesNotMatch(error.message,/PRIVATE|DOCTYPE|SyntaxError|Unexpected token|JSON.parse/);return true;
    });
    assert.equal(calls.filter(call=>call.path==='/api/moderation').length,1);
    assert.equal(calls[0]!.init.redirect,'error');
    const report=JSON.parse(String(calls.find(call=>call.path==='/api/moderation/errors')!.init.body));
    assert.deepEqual(Object.keys(report).sort(),['contentType','kind','operation','redirected','reference','status']);
    assert.equal(report.operation,'mute');assert.match(report.reference,/^[0-9a-f-]{36}$/);
    assert.doesNotMatch(JSON.stringify(report),/PRIVATE|DOCTYPE|username|cookie/i);
    await Promise.resolve();fetch.mock.restore();
  }
});

test('confirmed acceptance and structured partial errors preserve feedback and correlate the server reference',async t=>{
  const client=await import(new URL('../dist/browser/client/moderation-api.js',import.meta.url).href);
  const reference=randomUUID();
  const moderation={roomId:'fixture',serverNow:1000,entries:[]};
  let value:Record<string,unknown>={accepted:true,moderation};let status=200;
  const calls:string[]=[];
  t.mock.method(globalThis,'fetch',async(input:Parameters<typeof fetch>[0])=>{
    calls.push(String(input));return Response.json(value,{status,headers:{'X-Request-ID':reference}});
  });
  const accepted=await client.requestModeration('/api/moderation','mute',{action:'mute'});
  client.validateModerationReply(accepted,accepted.value.accepted===true);
  assert.deepEqual(accepted.value.moderation,moderation);assert.equal(accepted.reference,reference);
  status=502;value={error:'Demping geaccepteerd; blokkeren niet bevestigd.',partial:true,completed:['mute'],moderation};
  const partial=await client.requestModeration('/api/moderation','mute-ban',{action:'mute-ban'});
  assert.deepEqual(partial.value.moderation,moderation);assert.equal(partial.value.partial,true);
  assert.throws(()=>client.validateModerationReply(partial,false),new RegExp(`Demping geaccepteerd.*${reference}`));
  assert.deepEqual(calls,['/api/moderation','/api/moderation']);
  status=401;value={error:'Log eerst in met Discord.'};
  const login=await client.requestModeration('/api/moderation','access');
  assert.throws(()=>client.validateModerationReply(login,false),/Log eerst in met Discord/);
  assert.equal(calls.length,3);
});
