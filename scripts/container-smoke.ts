import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

const image = process.argv[2] || 'faynominaal-ci:local';
if (process.argv.length > 3 || !/^[\w./:@-]{1,200}$/.test(image)) throw new Error('Geef één geldige lokale imagenaam op.');
if (process.platform !== 'linux') throw new Error('Deze rooktest vereist Linux met Docker host networking.');
const prefix = `faynominaal-ci-${randomUUID()}`;
const container = `${prefix}-app`;
const volume = `${prefix}-data`;
const adminId = '100000000000000001';
const memberId = '100000000000000002';
let containerCreated = false;
let volumeCreated = false;

function docker(args: string[], timeout = 30_000): string {
  return execFileSync('docker', args, { encoding: 'utf8', timeout, maxBuffer: 256 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function inside(source: string): string {
  return docker(['exec', container, 'node', '--input-type=module', '--eval', source]);
}
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}
const port = await freePort();
const origin = `http://127.0.0.1:${port}`;

function start(): void {
  docker(['create', '--name', container, '--network', 'host', '--read-only', '--init',
    '--tmpfs', '/tmp:size=64m,mode=1777', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
    '--memory', '768m', '--cpus', '1', '--pids-limit', '64', '--mount', `type=volume,source=${volume},target=/app/data`,
    '--env', 'HOST=127.0.0.1', '--env', `PORT=${port}`, '--env', 'BOT_ENABLED=false',
    '--env', 'LIVE_AUTO_CONNECT=false', '--env', 'LIVE_AUTO_RECONNECT=false', '--env', 'TIKTOK_CHAT_TRANSPORT=euler',
    '--env', 'EULER_API_KEY=', '--env', 'TIKTOK_SESSION_ID=', '--env', 'TIKTOK_MS_TOKEN=', '--env', 'TIKTOK_VERIFY_FP=',
    '--env', 'TIKTOK_TARGET_IDC=', '--env', 'WHITELIST_AUTHENTICATED_SESSION_ID_HOST=',
    '--env', `DISCORD_CLIENT_ID=${adminId}`, '--env', 'DISCORD_CLIENT_SECRET=CI_FAKE_DISCORD_SECRET',
    '--env', `DISCORD_ADMIN_IDS=${adminId}`, '--env', `DISCORD_REDIRECT_URI=${origin}/auth/discord/callback`, image]);
  containerCreated = true;
  docker(['start', container]);
}
async function request(path: string, status: number, method = 'GET'): Promise<Response> {
  const response = await fetch(origin + path, { method, redirect: 'manual', signal: AbortSignal.timeout(3000) });
  assert.equal(response.status, status, `${method} ${path}`);
  return response;
}
async function ready(): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await request('/health', 200);
      assert.deepEqual(await response.json(), { ok: true, app: 'faynominaal-live' });
      return;
    } catch { await delay(250); }
  }
  throw new Error('Container werd niet binnen 30 seconden gezond.');
}
async function checkHttp(): Promise<void> {
  await request('/login', 200);
  await request('/', 302);
  const session = await request('/auth/session', 200);
  assert.deepEqual(await session.json(), { configured: true, authenticated: false });
  const rejectedLogin = await request('/auth/discord/callback?code=CI_FAKE_CODE&state=CI_INVALID_STATE', 302);
  assert.equal(rejectedLogin.headers.get('location'), '/login?error=state');
  for (const path of ['/api/config', '/api/snapshot', '/api/commands', '/api/access', '/api/capabilities', '/api/moderation', '/api/moderation/audit']) {
    await request(path, 401);
  }
  await request('/api/connect', 401, 'POST');
  for (const path of ['/.env', '/.env.example', '/data/access.json', '/secrets/discord-client-secret',
    '/.dev_docs/progress.md', '/.local-archive/signing-research/upstream/vendor/bootstrap.js', '/src/server/config.ts']) {
    await request(path, 404);
  }
}
function stopAndRemove(): void {
  docker(['stop', '--time', '10', container], 20_000);
  assert.equal(docker(['inspect', '--format', '{{.State.ExitCode}}', container]), '0');
  docker(['rm', container]);
  containerCreated = false;
}

try {
  assert.equal(docker(['image', 'inspect', '--format', '{{.Config.User}}', image]), 'node');
  docker(['volume', 'create', volume]); volumeCreated = true;
  start(); await ready(); await checkHttp();
  assert.equal(docker(['inspect', '--format', '{{.HostConfig.ReadonlyRootfs}}', container]), 'true');
  inside(`import assert from 'node:assert/strict'; import { existsSync, writeFileSync } from 'node:fs';
    assert.notEqual(process.getuid(), 0);
    assert.equal(existsSync('/app/.env'), false); assert.equal(existsSync('/app/.git'), false);
    assert.throws(() => writeFileSync('/app/ci-readonly-marker', 'fake'),
      error => ['EROFS', 'EACCES'].includes(error.code));`);
  inside(`import { loadCommandStore } from '/app/src/server/command-store.ts';
    import { loadAccessStore } from '/app/src/server/auth/access-store.ts';
    const commands = await loadCommandStore('/app/data/commands.json');
    await commands.save({ revision: commands.snapshot().revision, commands: [] });
    const access = await loadAccessStore('/app/data/access.json', ['${adminId}']);
    await access.save({ revision: access.snapshot().revision, users: [
      { id: '${adminId}', role: 'admin' }, { id: '${memberId}', role: 'member' }] });
    const {loadAuditStore} = await import('/app/src/server/moderation-audit.ts');
    const audit = await loadAuditStore('/app/data/moderation-audit.json');
    const intent = await audit.begin({ actor:{id:'${adminId}',name:'CI admin'}, target:{id:'456',name:'CI viewer'},
      roomId:'7300000000000000001', action:'mute', duration:30 });
    await audit.finish(intent.id,'accepted');`);
  stopAndRemove();
  start(); await ready(); await checkHttp();
  inside(`import assert from 'node:assert/strict'; import { statSync } from 'node:fs';
    import { loadCommandStore } from '/app/src/server/command-store.ts';
    import { loadAccessStore } from '/app/src/server/auth/access-store.ts';
    const commands = await loadCommandStore('/app/data/commands.json');
    assert.equal(commands.snapshot().revision, 1); assert.deepEqual(commands.list(), []);
    const access = await loadAccessStore('/app/data/access.json', ['${adminId}']);
    assert.equal(access.snapshot().revision, 1); assert.equal(access.role('${memberId}'), 'member');
    const {loadAuditStore} = await import('/app/src/server/moderation-audit.ts');
    const audit = await loadAuditStore('/app/data/moderation-audit.json');
    assert.equal(audit.list().length,1); assert.equal(audit.list()[0].actor.id,'${adminId}');
    assert.equal(audit.list()[0].status,'accepted');
    for (const path of ['/app/data/commands.json', '/app/data/access.json','/app/data/moderation-audit.json']) assert.equal(statSync(path).mode & 0o777, 0o600);`);
  stopAndRemove();
  console.log('Containercheck geslaagd: health, login/API-gates, privébestanden, non-root/read-only, shutdown en databehoud.');
} finally {
  if (containerCreated) { try { docker(['rm', '--force', container]); } catch { /* Bewaar de oorspronkelijke fout. */ } }
  if (volumeCreated) { try { docker(['volume', 'rm', volume]); } catch { /* Alleen deze rooktestvolume. */ } }
}
