import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createCommandLimiter} from '../src/server/command-limiter.ts';
import {createCommands} from '../src/server/commands.ts';
import {createCommandStore,loadCommandStore} from '../src/server/command-store.ts';
import {validateCommands} from '../src/server/command-validation.ts';
import {EventEmitter} from 'node:events';
import {createLive} from '../src/server/live.ts';
import {readConfig} from '../src/server/config.ts';
import type {LiveEvent} from '../src/shared/events.ts';

const definition={trigger:'!test',enabled:true,cooldownSeconds:30,responses:['Een','Twee']};
const limits={intervalSeconds:30,maxMessagesPerHour:20};

test('uurvenster deelt alle triggers/gebruikerbudgetten, telt deelberichten en schuift mee zonder reset bij nieuwe handlers',()=>{
  let time=100_000;
  const limiter=createCommandLimiter(()=>time,()=>limits);
  for(let index=0;index<20;index++){
    const ticket=limiter.reserve(1,`!test${index}`,`viewer${index}`,30);
    assert.ok(ticket);ticket.record();ticket.close();time+=30_000;
  }
  assert.equal(limiter.reserve(1,'!ander','ander',30),undefined);
  time=100_000+3600_000-1;
  assert.equal(limiter.reserve(1,'!ander','ander',30),undefined);
  time++;
  assert.equal(limiter.reserve(2,'!ander','ander',30),undefined);
  const ticket=limiter.reserve(1,'!ander','ander',30);
  assert.ok(ticket);ticket.record();ticket.close();
});

test('intervalverhoging tijdens wachten verlengt de pauze, uurverlaging stopt resterende deelberichten',async()=>{
  let time=100_000;
  let current={...limits};
  let changed=false;
  const times:number[]=[];
  const process=createCommands({active:()=>true,botUsername:'bot',report:assert.fail,getCommands:()=>[definition],
    getLimits:()=>current,now:()=>time,wait:async ms=>{
      time+=ms;
      if(ms&&!changed){changed=true;current={...current,intervalSeconds:60};}
    },send:async()=>{times.push(time);}});
  await process({content:'!test'});
  assert.deepEqual(times,[100_000,160_000]);
  let count=0;
  current={...limits};
  const long={...definition,responses:Array(6).fill('Antwoord')};
  const next=createCommands({active:()=>true,botUsername:'bot',report:assert.fail,getCommands:()=>[long],
    getLimits:()=>current,now:()=>time,wait:async ms=>{time+=ms;},send:async()=>{count++;current={...current,maxMessagesPerHour:5};}});
  await next({content:'!test'});
  assert.equal(count,5);
});

test('interval en uurmaximum blijven atomair bewaard bij herstart; oude clients wissen ingestelde limieten niet',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'fay-limits-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const path=join(directory,'commands.json');
  const store=await loadCommandStore(path);
  assert.deepEqual(store.limits(),limits);
  const custom={intervalSeconds:45,maxMessagesPerHour:40};
  await store.save({revision:0,commands:[{...definition,audience:'subscribers',responses:['Hallo {username}']}],limits:custom});
  const restarted=await loadCommandStore(path);
  assert.deepEqual(restarted.limits(),custom);
  assert.equal(restarted.list()[0].audience,'subscribers');
  assert.deepEqual(restarted.list()[0].responses,['Hallo {username}']);
  await restarted.save({revision:1,commands:[definition]});
  assert.deepEqual(restarted.limits(),custom);
  await assert.rejects(restarted.save({revision:1,commands:[],limits}),/gewijzigd/);
  assert.deepEqual(restarted.limits(),custom);
  assert.deepEqual(createCommandStore(undefined,{revision:0,commands:[definition]}).limits(),limits);
});

test('ongeldige limieten worden vóór opslag afgewezen',()=>{
  const document={revision:0,commands:[definition]};
  for(const invalid of [null,[],{...limits,intervalSeconds:29},{...limits,intervalSeconds:301},
    {...limits,maxMessagesPerHour:4},{...limits,maxMessagesPerHour:121},{...limits,intervalSeconds:30.5},
    {...limits,maxMessagesPerHour:'20'},{...limits,maxMessagesPerHour:NaN},{...limits,unlimited:true},{}]) {
    assert.throws(()=>validateCommands({...document,limits:invalid}));
  }
  for(const valid of [{intervalSeconds:30,maxMessagesPerHour:5},{intervalSeconds:300,maxMessagesPerHour:120}]){
    assert.deepEqual(validateCommands({...document,limits:valid}).limits,valid);
  }
});

test('ook mislukte verzendpogingen verbruiken het gedeelde uurmaximum',async()=>{
  let time=100_000;
  let attempts=0;
  const reports:string[]=[];
  const process=createCommands({active:()=>true,botUsername:'bot',getCommands:()=>[{...definition,responses:['Kort']}],
    getLimits:()=>({...limits,maxMessagesPerHour:5}),now:()=>time,wait:async ms=>{time+=ms;},
    send:async()=>{attempts++;throw new Error('Offline fout');},report:text=>{reports.push(text);}});
  for(let index=0;index<6;index++){await process({content:'!test'});time+=30_000;}
  assert.equal(attempts,5);
  assert.equal(reports.length,5);
});

test('Stop annuleert een echte lange timer meteen zonder volgende fakeverzending of foutmelding', {timeout:2000},async()=>{
  let connector!:Fake;
  let first!:()=>void;
  const sent=new Promise<void>(resolve=>{first=resolve;});
  let count=0;
  class Fake extends EventEmitter {
    constructor(){super();connector=this;}
    async connect(){}
    async disconnect(){this.emit('disconnected');}
    async sendMessage(){count++;first();}
  }
  const events:LiveEvent[]=[];
  const live=createLive(readConfig({BOT_ENABLED:'true',EULER_API_KEY:'dummy',TIKTOK_SESSION_ID:'dummy',TIKTOK_TARGET_IDC:'dummy'}),
    event=>events.push(event),async()=>({TikTokLiveConnection:Fake}),()=>[definition],()=>true);
  await live.connect();
  connector.emit('chat',{content:'!test',user:{uniqueId:'viewer'}});
  await sent;
  await live.stop();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(count,1);
  assert.ok(!events.some(event=>event.type==='bot'));
});
