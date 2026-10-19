import test from 'node:test';
import assert from 'node:assert/strict';

test('chat feedback counts down, keeps uncertain outcomes distinct and rejects previous-room responses', async t => {
  let elapsed = 0;
  let tick: (() => void) | undefined;
  const node = {dataset:{moderationUser:'456'},innerHTML:''};
  const globals = {
    performance:{now:()=>elapsed},
    document:{hidden:false,querySelectorAll:()=>[node]},
    setInterval:(callback:()=>void)=>{tick=callback;return 1;},clearInterval:()=>{}
  };
  for(const [key,value] of Object.entries(globals)) {
    const original=Object.getOwnPropertyDescriptor(globalThis,key);
    Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
    t.after(()=>{if(original)Object.defineProperty(globalThis,key,original);else Reflect.deleteProperty(globalThis,key);});
  }
  const {state}=await import(new URL('../dist/browser/client/model.js',import.meta.url).href);
  const client=await import(new URL('../dist/browser/client/moderation-feedback.js',import.meta.url).href);
  state.liveMode=true;state.serverConnected=true;state.phase='connected';state.page='Livechat';
  const mute={userId:'456',name:'Viewer',action:'mute',status:'accepted',at:'2026-10-18T12:00:00.000Z',duration:30,expiresAt:31_000};
  client.applyModerationFeedback({roomId:'room-a',serverNow:1000,entries:[mute]});
  assert.equal(client.activeDashboardMutes().length,1);
  assert.equal(client.confirmedRestriction('456','mute'),true);
  assert.equal(client.confirmedRestriction('456','ban'),false);
  assert.equal(client.confirmedRestriction(undefined,'mute'),false);
  assert.match(client.moderationBadges('456'),/Gedempt.*30s/);
  assert.equal(client.moderationBadges(undefined),'');
  assert.equal(client.moderationBadges('different-id'),'');
  client.initializeModerationFeedback();
  elapsed=5000;tick!();assert.match(node.innerHTML,/Gedempt.*25s/);
  elapsed=30_000;tick!();assert.match(node.innerHTML,/Verwachte demptijd verstreken/);
  assert.equal(client.activeDashboardMutes().length,0);
  assert.equal(client.confirmedRestriction('456','mute'),false);
  client.applyModerationFeedback({roomId:'room-a',serverNow:32_000,entries:[{...mute,status:'uncertain'}]});
  assert.match(client.moderationBadges('456'),/uitkomst onbekend/);
  assert.doesNotMatch(client.moderationBadges('456'),/data-active="true"/);
  assert.equal(client.activeDashboardMutes().length,0);
  assert.equal(client.confirmedRestriction('456','mute'),false);
  client.applyModerationFeedback({roomId:'room-a',serverNow:33_000,entries:[{...mute,action:'unmute'}]});
  assert.match(client.moderationBadges('456'),/Demping opgeheven/);
  assert.equal(client.confirmedRestriction('456','mute'),false);
  const oldGeneration=client.moderationGeneration();
  client.applyModerationFeedback({roomId:'room-b',serverNow:40_000,entries:[]});
  client.applyModerationFeedback({roomId:'room-a',serverNow:39_000,entries:[mute]});
  assert.deepEqual(client.moderationEntries(),[]);
  client.applyModerationFeedback({roomId:'room-a',serverNow:41_000,entries:[mute]},oldGeneration);
  assert.deepEqual(client.moderationEntries(),[]);
  const beforeDisconnect=client.moderationGeneration();
  client.applyModerationFeedback(undefined);
  client.applyModerationFeedback({roomId:'room-a',serverNow:42_000,entries:[mute]},beforeDisconnect);
  assert.deepEqual(client.moderationEntries(),[]);
  client.applyModerationFeedback({roomId:'room-b',serverNow:43_000,entries:[{...mute,duration:0,expiresAt:undefined}]});
  assert.match(client.moderationBadges('456'),/Gedempt.*deze LIVE/);
  assert.equal(client.confirmedRestriction('456','mute'),true);
  client.applyModerationFeedback({roomId:'room-b',serverNow:44_000,entries:[{...mute,action:'ban'}]});
  assert.equal(client.confirmedRestriction('456','ban'),true);
  client.applyModerationFeedback({roomId:'room-b',serverNow:45_000,entries:[{...mute,action:'unban'}]});
  assert.equal(client.confirmedRestriction('456','ban'),false);
  client.applyModerationFeedback({roomId:'room-b',serverNow:46_000,entries:[{...mute,action:'ban',status:'uncertain'}]});
  assert.equal(client.confirmedRestriction('456','ban'),false);
  state.liveMode=false;assert.deepEqual(client.moderationEntries(),[]);
  state.liveMode=true;state.serverConnected=false;assert.deepEqual(client.moderationEntries(),[]);
  state.serverConnected=true;state.phase='stopped';assert.deepEqual(client.moderationEntries(),[]);
});
