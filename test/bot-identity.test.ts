import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {incomingChat} from '../src/server/incoming-chat.ts';
import {automaticCategory} from '../src/client/filters.ts';
import {createSession} from '../src/server/session.ts';
import {createLive} from '../src/server/live.ts';
import {readConfig} from '../src/server/config.ts';
import {moderationDisabledReason} from '../src/shared/moderation-policy.ts';
import {escapeHTML} from '../src/client/dom.ts';

test('eigen bot wordt herkend op gecontroleerd ID; verwachte naam is fallback, nickname of berichtinhoud nooit',()=>{
  assert.equal(incomingChat({user:{uniqueId:'FaynominaalBot'}},'faynominaalbot').isBot,true);
  assert.equal(incomingChat({user:{displayId:'@faynominaalbot'}},'faynominaalbot').isBot,true);
  assert.equal(incomingChat({user:{uniqueId:'oude_naam',idStr:'123'}},'faynominaalbot','123').isBot,true);
  assert.equal(incomingChat({user:{uniqueId:'faynominaalbot',id:'456'}},'faynominaalbot','123').isBot,false);
  assert.equal(incomingChat({user:{uniqueId:'kijker',nickname:'faynominaalbot'},content:'@faynominaalbot'},'faynominaalbot').isBot,false);
});

test('botmarker blijft in SSE en snapshot; automatische beoordeling slaat alleen eigen bot over',()=>{
  const settings={links:true,spam:true,swearing:true,words:'sukkel'};
  const text='https://example.invalid/ sukkel haaaahaaaahaaa';
  const message=incomingChat({user:{uniqueId:'faynominaalbot',id:'123'},content:text},'faynominaalbot','123');
  const session=createSession(()=>{});session.receive(message);
  const restored=session.snapshot().messages[0];
  assert.equal(restored.isBot,true);assert.equal(automaticCategory(restored,settings),null);
  assert.equal(automaticCategory({...restored,isBot:false},settings),'Links');
  assert.match(moderationDisabledReason({liveMode:true,serverConnected:true,phase:'connected'},restored,'mute'),/zichzelf/);
  const hostile='<img src=x onerror="alert(1)">\' &';
  assert.equal(escapeHTML(hostile),'&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&#39; &amp;');
});

test('eigen ontvangen command wordt nooit opnieuw uitgevoerd, ook bij veranderd handle met hetzelfde bot-ID',async t=>{
  let connector!:Fake;let sends=0;
  class Fake extends EventEmitter {
    constructor(){super();connector=this;}
    async connect(){}
    async disconnect(){}
    async sendMessage(){sends++;}
  }
  const config=readConfig({BOT_ENABLED:'true',EULER_API_KEY:'FAKE',TIKTOK_SESSION_ID:'FAKE',TIKTOK_TARGET_IDC:'test'});
  const live=createLive(config,()=>{},async()=>({TikTokLiveConnection:Fake}),
    ()=>[{trigger:'!test',responses:['Niet herhalen'],cooldownSeconds:30,enabled:true}],()=>true,undefined,undefined,undefined,()=> '123');
  t.after(()=>live.stop());await live.connect();
  connector.emit('chat',{content:'!test',user:{id:'123',uniqueId:'ander_handle'}});
  await new Promise(resolve=>setTimeout(resolve,10));assert.equal(sends,0);
});

test('direct mode geeft geen TikTok-accountcookies aan de receiver; legacy Euler blijft expliciet apart',()=>{
  const env={EULER_API_KEY:'KEY',TIKTOK_SESSION_ID:'PRIVATE_SESSION',TIKTOK_TARGET_IDC:'test',TIKTOK_MS_TOKEN:'TOKEN',TIKTOK_VERIFY_FP:'verify_FP'};
  const direct=readConfig({...env,TIKTOK_CHAT_TRANSPORT:'direct'});
  assert.equal(direct.options.authenticateWs,false);assert.equal(direct.options.session,undefined);
  assert.ok(!JSON.stringify(direct.options).includes('PRIVATE_SESSION'));
  assert.equal(direct.directCredentials?.sessionId,'PRIVATE_SESSION');
  assert.equal(readConfig(env).options.authenticateWs,true);
});
