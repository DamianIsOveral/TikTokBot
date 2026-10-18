import test from 'node:test';
import assert from 'node:assert/strict';
import {mayTriggerCommand} from '../src/server/command-audience.ts';
import {createCommands} from '../src/server/commands.ts';
import {validateCommands} from '../src/server/command-validation.ts';
import type {TikTokMessage} from '../src/server/types.ts';
import type {CommandDefinition} from '../src/shared/commands.ts';

test('beperkte commands vereisen positieve rolgegevens van TikTok; host/moderators mogen alle commands gebruiken',()=>{
  assert.equal(mayTriggerCommand(undefined,{},'host'),true);
  for(const audience of ['moderators','subscribers','supporters'] as const){
    assert.equal(mayTriggerCommand(audience,{},'host'),false);
    assert.equal(mayTriggerCommand(audience,{user:{nickname:'Moderator'}},'host'),false);
    assert.equal(mayTriggerCommand(audience,{userIdentity:{isAnchor:true}},'host'),true);
    assert.equal(mayTriggerCommand(audience,{user:{uniqueId:'HOST'}},'host'),true);
    assert.equal(mayTriggerCommand(audience,{userIdentity:{isModeratorOfAnchor:true}},'host'),true);
    assert.equal(mayTriggerCommand(audience,{user:{userAttr:{isAdmin:true}}},'host'),true);
    assert.equal(mayTriggerCommand(audience,{user:{badgeList:[{sceneType:1}]}},'host'),true);
  }
  const subscriber={userIdentity:{isSubscriberOfAnchor:true}};
  assert.equal(mayTriggerCommand('moderators',subscriber,'host'),false);
  assert.equal(mayTriggerCommand('subscribers',subscriber,'host'),true);
  assert.equal(mayTriggerCommand('supporters',subscriber,'host'),true);
  for(const sceneType of [4,7])assert.equal(mayTriggerCommand('subscribers',{user:{badgeList:[{sceneType}]}},'host'),true);
  for(const flag of [false,0,1,'true','false',null]){
    assert.equal(mayTriggerCommand('moderators',{userIdentity:{isModeratorOfAnchor:flag}} as TikTokMessage,'host'),false);
  }
});

test('topgiftertoegang herkent alleen top-3-badges op TikTok-CDN en niet een naam of willekeurige gift',()=>{
  const badge=(url:string):TikTokMessage=>({user:{badgeList:[{combine:{icon:{urlList:[url]}}}]}});
  for(const rank of [1,2,3]) assert.equal(mayTriggerCommand('supporters',badge(`https://p16-webcast.tiktokcdn.com/webcast/ranklist_top_gifter_${rank}.png~tplv-obj.image`),'host'),true);
  for(const url of ['https://example.invalid/ranklist_top_gifter_1.png','https://tiktokcdn.com.evil.invalid/ranklist_top_gifter_1.png',
    'http://tiktokcdn.com/ranklist_top_gifter_1.png','https://tiktokcdn.com/ranklist_top_gifter_4.png','invalid']){
    assert.equal(mayTriggerCommand('supporters',badge(url),'host'),false);
  }
  assert.equal(mayTriggerCommand('supporters',{user:{nickname:'Top Gifter',badgeList:[{sceneType:8}]}},'host'),false);
  assert.equal(mayTriggerCommand('subscribers',badge('https://tiktokcdn.com/ranklist_top_gifter_1.png'),'host'),false);
});

test('afgewezen rollen gebruiken geen cooldown/budget; aliases erven dezelfde toegang',async()=>{
  const definition:CommandDefinition={trigger:'!test',aliases:['!t'],audience:'moderators',enabled:true,cooldownSeconds:60,responses:['Hallo {username}']};
  const sent:string[]=[];
  const process=createCommands({active:()=>true,botUsername:'bot',channel:'host',report:assert.fail,
    getCommands:()=>[definition],wait:async()=>{},send:async text=>{sent.push(text);}});
  await process({content:'!t',user:{uniqueId:'viewer'}});
  await process({content:'!test',user:{uniqueId:'viewer'}});
  assert.deepEqual(sent,[]);
  await process({content:'!t',user:{uniqueId:'viewer'},userIdentity:{isModeratorOfAnchor:true}});
  assert.deepEqual(sent,['Hallo viewer']);
  for(const audience of ['admin','topgifters',null,['moderators'],true,1]) {
    assert.throws(()=>validateCommands({revision:0,commands:[{...definition,audience}]}));
  }
});
