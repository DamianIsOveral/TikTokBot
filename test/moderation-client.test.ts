import test from 'node:test';
import assert from 'node:assert/strict';
import { createDirectModeration } from '../src/server/tiktok/moderation-client.ts';
import { DirectTikTokError } from '../src/server/tiktok/direct-client.ts';
import { signingUserAgent, validateSigningInput } from '../src/server/tiktok/signing-profile.ts';
import { signPostWithUpstream } from '../src/server/tiktok/upstream-post-signer.ts';
import { buildModerationRequest } from '../src/server/tiktok/moderation-spec.ts';

const roomId = '7300000000000000001';
const target = { userId: '456', secUid: 'SEC_TARGET' };

test('alle vier moderatieacties gebruiken eigen rechten, exact doel en dezelfde gesigneerde bodyvorm', async () => {
  const writes: string[] = [];
  const moderation = createDirectModeration({ verifyIdentity: async () => {}, botUserId: () => '123',
    readProfile: async username => ({ userId: '999', secUid: 'SEC_OWNER', username }), resolveRoomId: async () => roomId,
    request: async spec => {
      if (!spec.method) return { data: { user: { id_str: spec.query?.target_uid || '123',
        user_attr: { is_admin: spec.query?.target_uid === '123', admin_permissions: { '2': 1, '3': 1 } } } } };
      writes.push(spec.path);
      const input = { url: `https://webcast.tiktok.com${spec.path}?aid=1988`, userAgent: signingUserAgent,
        method: spec.method, body: spec.body, contentType: spec.contentType };
      validateSigningInput(input);
      return { status_code: 0 };
    } });
  for (const action of ['mute', 'unmute', 'ban', 'unban'] as const) assert.deepEqual(await moderation.act('streamer', roomId, action, target), { accepted: true });
  assert.deepEqual(writes, ['/webcast/room/silence/', '/webcast/room/unsilence/', '/webcast/room/kick/user/', '/webcast/room/unkick/user/']);
});

test('mute- en blokkeerrechten zijn gescheiden; bot/host en onbekende rechten blokkeren vóór POST', async () => {
  for (const rights of [{ '2': 1, '3': 0 }, {}]) {
    let writes = 0;
    const moderation = createDirectModeration({ verifyIdentity: async () => {}, botUserId: () => '123',
      readProfile: async username => ({ userId: '999', secUid: 'SEC_OWNER', username }), resolveRoomId: async () => roomId,
      request: async spec => {
        if (spec.method) { writes++; return {}; }
        return { data: { id_str: '123', user_attr: { is_admin: true, admin_permissions: rights } } };
      } });
    await assert.rejects(moderation.act('streamer', roomId, 'ban', target), DirectTikTokError);
    await assert.rejects(moderation.act('streamer', roomId, 'mute', { ...target, userId: '123' }), DirectTikTokError);
    await assert.rejects(moderation.act('streamer', roomId, 'mute', { ...target, userId: '999' }), DirectTikTokError);
    assert.equal(writes, 0);
  }
});

test('moderatie accepteert alleen een exacte bot-ID uit de rechtenresponse', async () => {
  const moderation = createDirectModeration({ verifyIdentity: async () => {}, botUserId: () => '123',
    readProfile: async username => ({ userId: '999', secUid: 'SEC_OWNER', username }), resolveRoomId: async () => roomId,
    request: async () => ({ data: { id_str: '124', user_attr: { is_admin: true, admin_permissions: { '2': 1, '3': 1 } } } }) });
  await assert.rejects(moderation.access('streamer', roomId), DirectTikTokError);
});

test('unban geeft formbytes en contenttype aan de SDK door; geen JSON of GET-terugval', () => {
  const spec = buildModerationRequest('unban', roomId, target);
  const input = { url: `https://webcast.tiktok.com${spec.path}?aid=1988`, userAgent: signingUserAgent,
    method: spec.method, body: spec.body, contentType: spec.contentType };
  const suffix = '&X-Dynosaur=x&msToken=x&X-Bogus=x&X-Gnarly=x';
  const bootstrap = `globalThis.ttlPrepare=()=>{
    globalThis.__ttlPrepared={w:{fetch(url,init){
      if(init.method!=='POST'||init.body!==${JSON.stringify(spec.body)}||init.headers['Content-Type']!=='application/x-www-form-urlencoded')throw Error();
      globalThis.__ttlCaptured=url+${JSON.stringify(suffix)};
    }}};return '{"ok":true}';};`;
  assert.equal(signPostWithUpstream(bootstrap, 'FAKE', input), input.url + suffix);
  assert.throws(() => validateSigningInput({ ...input, url: input.url + '&kick_uid=456' }));
});
