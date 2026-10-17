import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {validateCommands} from '../src/server/command-validation.ts';
import {loadCommandStore} from '../src/server/command-store.ts';
import {createCommands} from '../src/server/commands.ts';

const command={trigger:'!discord',aliases:['!dc','!community'],responses:['Hetzelfde antwoord'],cooldownSeconds:60,enabled:true};
test('aliases zijn wereldwijd uniek, begrensd en hoofdletterongevoelig; oudere configuraties blijven geldig',()=>{
  const validate=(commands:unknown[])=>validateCommands({revision:0,commands});
  assert.deepEqual(validate([{...command,aliases:[' !DC ','!Community']}]).commands[0].aliases,['!dc','!community']);
  assert.equal(validate([{...command,aliases:undefined}]).commands[0].aliases,undefined);
  for(const aliases of [null,'!dc',Array(11).fill('!alias'),['dc'],['!dc','!DC'],['!discord'],['!<x>'],[123]]) {
    assert.throws(()=>validate([{...command,aliases}]));
  }
  for(const pair of [
    [command,{...command,trigger:'!dc',aliases:[]}],
    [{...command,trigger:'!dc',aliases:[]},command],
    [command,{...command,trigger:'!other',aliases:['!dc']}]
  ]) assert.throws(()=>validate(pair));
});

test('hoofdcommando en aliases delen cooldown en blokkeren na uitschakelen of verwijderen',async()=>{
  let time=100_000;
  let definitions=[command];
  const sent:string[]=[];
  const process=createCommands({active:()=>true,botUsername:'bot',report:assert.fail,getCommands:()=>definitions,
    now:()=>time,wait:async ms=>{time+=ms;},send:async text=>{sent.push(text);}});
  await process({content:' !DC ',user:{uniqueId:'first'}});
  assert.deepEqual(sent,['Hetzelfde antwoord']);
  for(const content of ['!discord','!community']) {
    time+=15_000;
    await process({content,user:{uniqueId:'other'}});
  }
  assert.equal(sent.length,1);
  time+=31_000;
  await process({content:'!community',user:{uniqueId:'third'}});
  assert.equal(sent.length,2);
  time+=61_000;
  definitions=[{...command,enabled:false}];
  await process({content:'!dc'});
  definitions=[{...command,aliases:[]}];
  await process({content:'!dc'});
  assert.equal(sent.length,2);
});

test('aliases blijven bewaard na serverherstart',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'fay-aliases-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const path=join(directory,'commands.json');
  const store=await loadCommandStore(path);
  await store.save({revision:0,commands:[command]});
  const restarted=await loadCommandStore(path);
  assert.deepEqual(restarted.list(),[command]);
});
