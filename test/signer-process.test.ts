import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import type {ChildProcessWithoutNullStreams} from 'node:child_process';
import {createSignerProcess} from '../src/server/tiktok/signer-process.ts';
import {signingUserAgent} from '../src/server/tiktok/signing-profile.ts';

const input={url:'https://webcast.tiktok.com/webcast/room/chat/?room_id=7300000000000000001&content=Offline',userAgent:signingUserAgent,msToken:'FAKE'};
class Child extends EventEmitter {
  stdin=new PassThrough();stdout=new PassThrough();stderr=new PassThrough();killed=false;
  kill(){this.killed=true;this.emit('close',1);return true;}
}
function reply(child:Child,data:Buffer,overrides:Record<string,unknown>={}):void{
  const frame=JSON.parse(data.toString());
  child.stdout.write(JSON.stringify({id:frame.id,signedUrl:frame.input.url+'&X-Dynosaur=x&msToken='+frame.input.msToken+'&X-Bogus=x&X-Gnarly=x',signMs:10,rssMiB:75,...overrides})+'\n');
}
test('permanente signer deelt één child, bewaart nieuwe tokencontext en sluit expliciet',async()=>{
  let starts=0;let child!:Child;
  const sign=createSignerProcess(()=>{starts++;child=new Child();child.stdin.on('data',data=>reply(child,data));return child as unknown as ChildProcessWithoutNullStreams;});
  await sign(input);const next=await sign({...input,msToken:'OTHER'});
  assert.match(next.signedUrl,/msToken=OTHER/);assert.equal(starts,1);
  sign.close!();assert.equal(child.killed,true);await assert.rejects(sign(input));
});
test('crash, corrupt protocol, verkeerde ID, ongeldige signature en timeout falen eenmaal; volgende aanvraag start nieuw',async()=>{
  for(const mode of ['crash','json','id','signature','size','timeout']){
    let count=0;let child!:Child;
    const sign=createSignerProcess(()=>{
      const current=new Child();child=current;count++;
      current.stdin.on('data',data=>{
        if(count>1){reply(current,data);return;}
        if(mode==='crash')current.emit('close',1);
        if(mode==='json')current.stdout.write('bad\n');
        if(mode==='id')reply(current,data,{id:-1});
        if(mode==='signature')reply(current,data,{signedUrl:'https://evil.invalid/'});
        if(mode==='size')current.stdout.write('x'.repeat(32769));
      });return current as unknown as ChildProcessWithoutNullStreams;
    },20);
    await assert.rejects(sign(input));assert.equal(count,1);
    await sign(input);assert.equal(count,2);assert.equal(sign.workerStats!().restarts,1);sign.close!();assert.equal(child.killed,true);
  }
});
test('parallel verzoek wordt geweigerd en recyclen na 100 antwoorden of hoge RSS bewaart resultaat',async()=>{
  let child!:Child;
  const blocked=createSignerProcess(()=>{child=new Child();return child as unknown as ChildProcessWithoutNullStreams;});
  const first=blocked(input);await assert.rejects(blocked(input));blocked.close!();await assert.rejects(first);
  let starts=0;
  const sign=createSignerProcess(()=>{const next=new Child();starts++;next.stdin.on('data',data=>reply(next,data));return next as unknown as ChildProcessWithoutNullStreams;});
  for(let index=0;index<101;index++)await sign(input);assert.equal(starts,2);sign.close!();
  const large=createSignerProcess(()=>{const next=new Child();next.stdin.on('data',data=>reply(next,data,{rssMiB:129}));return next as unknown as ChildProcessWithoutNullStreams;});
  await large(input);await large(input);assert.equal(large.workerStats!().starts,2);large.close!();
});
test('pipefouten en mislukte spawn blijven lokaal; idle worker wordt zonder nieuwe aanvraag beëindigd',async()=>{
  for(const stream of ['stdin','stdout','stderr'] as const){
    const child=new Child();child.stdin.on('data',()=>child[stream].emit('error',new Error('PRIVATE')));
    const sign=createSignerProcess(()=>child as unknown as ChildProcessWithoutNullStreams);
    await assert.rejects(sign(input),error=>{assert.ok(!String(error).includes('PRIVATE'));return true;});sign.close!();
  }
  const broken=createSignerProcess(()=>{throw new Error('PRIVATE');});await assert.rejects(broken(input));broken.close!();
  let child!:Child;
  const sign=createSignerProcess(()=>{child=new Child();child.stdin.on('data',data=>reply(child,data));return child as unknown as ChildProcessWithoutNullStreams;},100,5);
  await sign(input);await new Promise(resolve=>setTimeout(resolve,20));assert.equal(child.killed,true);sign.close!();
});
