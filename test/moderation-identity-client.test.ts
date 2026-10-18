import test from 'node:test';
import assert from 'node:assert/strict';

test('moderation identities join by stable id, preserve canonical names and escape display names', async () => {
  const {state}=await import(new URL('../dist/browser/client/model.js',import.meta.url).href);
  const {moderationIdentity}=await import(new URL('../dist/browser/client/moderation-identity.js',import.meta.url).href);
  state.messages=[{id:1,user:'canonical_viewer',displayName:'Visible <Viewer>',userId:'456',resolved:false,text:'Chat',time:'12:00'}];
  assert.match(moderationIdentity('456','user123456'),/Visible &lt;Viewer&gt;/);
  assert.match(moderationIdentity('456','user123456'),/<small>@canonical_viewer<\/small>/);
  assert.match(moderationIdentity('456','canonical_viewer',undefined,'canonical_viewer'),/Visible &lt;Viewer&gt;/);
  assert.match(moderationIdentity('456','user123456','Saved Display','canonical_viewer'),/>Saved Display<\/strong>/);
  assert.doesNotMatch(moderationIdentity('different-id','user123456'),/canonical_viewer|Visible/);
  assert.match(moderationIdentity('different-id','<script>'),/&lt;script&gt;/);
  state.messages=[];
  assert.match(moderationIdentity('456','canonical_viewer','Saved Display','canonical_viewer'),/Saved Display/);
  assert.match(moderationIdentity('456','canonical_viewer',undefined,'canonical_viewer'),/@canonical_viewer/);
});
