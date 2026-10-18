import { readConfig } from '../src/server/config.ts';
import { readSecretEnvironment } from '../src/server/secret-env.ts';
import { createDirectClient, DirectTikTokError, directErrorText } from '../src/server/tiktok/direct-client.ts';
import { createHeadlessSigner } from '../src/server/tiktok/headless-signer.ts';
import { createReadOnlyRequest } from '../src/server/tiktok/read-only-request.ts';
import { loadAuditStore } from '../src/server/moderation-audit.ts';
import { auditedModeration } from '../src/server/moderation-action.ts';
import { fileURLToPath } from 'node:url';
import type {DirectRequestSigner} from '../src/server/tiktok/signing-profile.ts';
let signer:DirectRequestSigner|undefined;

const [mode, argument] = process.argv.slice(2);
if (!['--inspect', '--test-once'].includes(mode) || !/^@?[\w.]{1,24}$/.test(argument || '') || process.argv.length !== 4) {
  throw new Error('Gebruik --inspect @testaccount of expliciet --test-once @testaccount.');
}
const env = readSecretEnvironment(process.env);
const config = readConfig(env);
const targetName = argument.replace(/^@/, '').toLowerCase();
if ([config.username.toLowerCase(), config.botUsername.toLowerCase()].includes(targetName)) throw new Error('Gebruik een apart testaccount.');
const readonly = mode === '--inspect' ? createReadOnlyRequest() : undefined;
const posts: string[] = [];
const request: typeof fetch = async (input, init) => {
  if (init?.method === 'POST') posts.push(new URL(String(input)).pathname);
  return (readonly?.request || fetch)(input, init);
};
function report(error: unknown) {
  return { message: directErrorText(error), kind: error instanceof DirectTikTokError ? error.kind : 'network',
    http: error instanceof DirectTikTokError ? error.status : undefined,
    apiCode: error instanceof DirectTikTokError ? error.apiCode : undefined };
}
try {
  signer=await createHeadlessSigner();
  const direct = createDirectClient({ sessionId: env.TIKTOK_SESSION_ID || '', targetIdc: env.TIKTOK_TARGET_IDC || '',
    botUsername: config.botUsername, msToken: env.TIKTOK_MS_TOKEN, verifyFp: env.TIKTOK_VERIFY_FP }, request,
  { signRequest: signer });
  await direct.verifyIdentity();
  const roomId = await direct.resolveRoomId(config.username);
  const target = await direct.moderation.resolveTarget(targetName);
  const rights = await direct.moderation.access(config.username, roomId);
  const targetStatus = await direct.moderation.targetStatus(config.username, roomId, target);
  console.log(JSON.stringify({ prepared: true, target: targetName, botCanMute: rights.mute, botCanBan: rights.ban, sent: false }));
  async function scan(kind: 'muted' | 'blocked') {
    let cursor = '';
    const seen = new Set<string>();
    for (let page = 0; page < 50; page++) {
      const result = await direct.moderation.list(config.username, roomId, kind, page, cursor);
      if (result.users.some(user => user.userId === target.userId)) return { found: true, complete: true, pages: page + 1 };
      if (!result.hasMore) return { found: false, complete: true, pages: page + 1 };
      if (!result.users.length || result.users.every(user => seen.has(user.userId))) break;
      for (const user of result.users) seen.add(user.userId);
      cursor = result.cursor;
    }
    return { found: false, complete: false };
  }
  const muted = await scan('muted');
  const blocked = await scan('blocked');
  const initiallyMuted = muted.found;
  const initiallyBlocked = blocked.found;
  console.log(JSON.stringify({ targetModerator: targetStatus.moderator, initiallyMuted, initiallyBlocked,
    listsComplete: muted.complete && blocked.complete, pagesRead: { muted: muted.pages, blocked: blocked.pages },
    network: readonly?.summary() }));
  if (mode === '--test-once') {
    if (targetStatus.moderator || initiallyMuted || initiallyBlocked || !muted.complete || !blocked.complete) throw new Error('Beginstatus niet geschikt voor een herstelbare proef.');
    const audit = await loadAuditStore(fileURLToPath(new URL('../data/moderation-audit.json', import.meta.url)));
    const act = (action: 'mute' | 'unmute' | 'ban' | 'unban') => auditedModeration(audit, {
      actor: { id: 'system', name: 'CLI-test (geen Discordsessie)' }, target: { id: target.userId, name: targetName },
      roomId, action, ...(action === 'mute' ? { duration: 30 } : {})
    }, () => direct.moderation.act(config.username, roomId, action, target, 30));
    for (const [action, recovery, list] of [['mute', 'unmute', 'muted'], ['ban', 'unban', 'blocked']] as const) {
      let accepted = false;
      let failure: unknown;
      const beforePosts = posts.length;
      try {
        await act(action);
        accepted = true;
        const after = await scan(list);
        console.log(JSON.stringify({ action, accepted: true, observedInList: after.found }));
      } catch (error) { failure = error; console.log(JSON.stringify({ action, accepted: false, ...report(error) })); }
      const uncertain = failure && (!(failure instanceof DirectTikTokError) || ['network', 'empty', 'response'].includes(failure.kind));
      if (accepted || (uncertain && posts.length > beforePosts)) {
        await act(recovery);
        const after = await scan(list);
        console.log(JSON.stringify({ action: recovery, accepted: true,
          restored: after.complete && !after.found }));
      }
      if (failure) { process.exitCode = 1; break; }
    }
  }
  console.log(JSON.stringify({ completed: true, writeRequests: posts.length, network: readonly?.summary() }));
} catch (error) {
  console.log(JSON.stringify({ completed: false, writeRequests: posts.length, ...report(error) }));
  process.exitCode = 1;
}finally{signer?.close?.();}
