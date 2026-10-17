import test from 'node:test';
import assert from 'node:assert/strict';
import { moderationDisabledReason as reason } from '../src/shared/moderation-policy.ts';

const target={userId:'7696933735691142176',secUid:'SEC_VIEWER'};
const context={liveMode:true,serverConnected:true,phase:'connected',
  moderation:{connected:true,enabled:true,mute:true,ban:true,reason:'Botrechten gecontroleerd.'}};
test('knoppen worden alleen beschikbaar met actieve verbinding, rechten en exacte gebruikersgegevens', () => {
  assert.equal(reason(context,target,'mute'),'');
  assert.equal(reason(context,target,'ban'),'');
  assert.match(reason(context,{},'mute'),/Gebruikersgegevens ontbreken/);
  assert.match(reason({...context,serverConnected:false},target,'mute'),/onderbroken/);
  assert.match(reason({...context,phase:'stopped'},target,'mute'),/Verbind eerst/);
  assert.match(reason({...context,moderation:undefined},target,'mute'),/gecontroleerd/);
  assert.match(reason({...context,moderation:{...context.moderation,enabled:false,reason:'Moderatie staat uit.'}},target,'mute'),/staat uit/);
  assert.match(reason({...context,moderation:{...context.moderation,ban:false}},target,'ban'),/geen blokkeerrecht/);
  assert.equal(reason({...context,liveMode:false},{},'mute'),'');
});
