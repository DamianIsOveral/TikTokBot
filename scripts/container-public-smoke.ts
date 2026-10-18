import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import type { IncomingHttpHeaders } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

const image = process.argv[2] || 'faynominaal-ci:local';
if (process.argv.length > 3 || !/^[\w./:@-]{1,200}$/.test(image)) throw new Error('Geef één geldige lokale imagenaam op.');
const prefix = `faynominaal-public-ci-${randomUUID()}`;
const container = `${prefix}-app`;
const network = `${prefix}-network`;
const volume = `${prefix}-data`;
const publicOrigin = 'https://dashboard.example.com';
const publicHost = new URL(publicOrigin).host;
let containerCreated = false;
let networkCreated = false;
let volumeCreated = false;
let port = 0;

function docker(args: string[], timeout = 30_000): string {
  return execFileSync('docker', args, { encoding: 'utf8', timeout, maxBuffer: 256 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function inside(source: string): string {
  return docker(['exec', container, 'node', '--input-type=module', '--eval', source]);
}
type Reply = { headers: IncomingHttpHeaders; body: string };
async function request(path: string, status: number, headers: Record<string, string> = {}, method = 'GET'): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port, path, method,
      headers: { Host: publicHost, ...headers }, timeout: 3000 }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('error', reject);
      res.on('end', () => {
        try {
          assert.equal(res.statusCode, status, `${method} ${path} (Host: ${headers.Host || publicHost})`);
          resolve({ headers: res.headers, body });
        } catch (error) { reject(error); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('HTTP-rooktest time-out.')));
    req.on('error', reject);
    req.end();
  });
}
async function ready(): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await request('/health', 200);
      assert.deepEqual(JSON.parse(response.body), { ok: true, app: 'faynominaal-live' });
      docker(['exec', container, 'node', 'scripts/healthcheck.ts']);
      return;
    } catch { await delay(250); }
  }
  throw new Error('Publieke container werd niet binnen 30 seconden gezond.');
}
async function checkHttp(): Promise<void> {
  await request('/login', 200);
  assert.equal((await request('/', 302)).headers.location, '/login');
  assert.deepEqual(JSON.parse((await request('/auth/session', 200)).body), { configured: true, authenticated: false });
  for (const path of ['/api/config', '/api/snapshot', '/api/commands', '/api/access', '/api/capabilities',
    '/api/moderation', '/api/moderation/audit', '/api/readiness', '/api/diagnostics', '/api/bot-session']) {
    await request(path, 401);
  }
  await request('/api/connect', 401, { Origin: publicOrigin, 'X-Requested-With': 'faynominaal' }, 'POST');
  const login = await request('/auth/login', 302, { 'X-Forwarded-Host': 'evil.example', 'X-Forwarded-Proto': 'http' });
  const target = new URL(login.headers.location!);
  assert.equal(target.origin, 'https://discord.com');
  assert.equal(target.pathname, '/oauth2/authorize');
  assert.equal(target.searchParams.get('redirect_uri'), `${publicOrigin}/auth/discord/callback`);
  assert.equal(target.searchParams.get('client_id'), '100000000000000001');
  assert.ok(target.searchParams.get('state'));
  assert.ok(login.headers['set-cookie']?.some(value => /^fay_oauth=/.test(value)
    && /; Secure(?:;|$)/.test(value) && /; HttpOnly(?:;|$)/.test(value) && /; SameSite=Lax(?:;|$)/.test(value)));
  assert.equal((await request('/auth/discord/callback?code=CI_FAKE_CODE&state=CI_INVALID_STATE', 302)).headers.location,
    '/login?error=state');
  for (const path of ['/', '/login', '/auth/login', '/api/config', '/health']) {
    await request(path, 403, { Host: 'evil.example', 'X-Forwarded-Host': publicHost, 'X-Forwarded-Proto': 'https' });
  }
  for (const path of ['/', '/login', '/auth/session', '/api/config']) {
    await request(path, 403, { Host: '127.0.0.1:3000' });
  }
  await request('/health', 200, { Host: '127.0.0.1:3000' });
  const mutation = { 'X-Requested-With': 'faynominaal', 'X-Forwarded-Host': 'evil.example', 'X-Forwarded-Proto': 'http' };
  await request('/auth/logout', 403, { ...mutation, Origin: 'http://evil.example' }, 'POST');
  await request('/auth/logout', 403, { ...mutation, Origin: `http://${publicHost}` }, 'POST');
  const logout = await request('/auth/logout', 204, { ...mutation, Origin: publicOrigin }, 'POST');
  assert.ok(logout.headers['set-cookie']?.some(value => /^fay_session=/.test(value) && /; Secure(?:;|$)/.test(value)));
  for (const path of ['/.env', '/data/access.json', '/data/tiktok-session.json', '/src/server/config.ts']) {
    await request(path, 404);
  }
}

try {
  assert.equal(docker(['image', 'inspect', '--format', '{{.Config.User}}', image]), 'node');
  docker(['network', 'create', '--driver', 'bridge', network]); networkCreated = true;
  docker(['volume', 'create', volume]); volumeCreated = true;
  // Only this test publishes a random loopback port to simulate the HTTPS proxy.
  docker(['create', '--name', container, '--network', network, '--publish', '127.0.0.1::3000', '--read-only', '--init',
    '--tmpfs', '/tmp:size=64m,mode=1777', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
    '--memory', '768m', '--cpus', '1', '--pids-limit', '64', '--mount', `type=volume,source=${volume},target=/app/data`,
    '--env', 'HOST=0.0.0.0', '--env', 'PORT=3000', '--env', `PUBLIC_ORIGIN=${publicOrigin}`,
    '--env', 'BOT_ENABLED=false', '--env', 'LIVE_AUTO_CONNECT=false', '--env', 'LIVE_AUTO_RECONNECT=false',
    '--env', 'TIKTOK_CHAT_TRANSPORT=euler', '--env', 'EULER_API_KEY=', '--env', 'TIKTOK_SESSION_ID=',
    '--env', 'TIKTOK_MS_TOKEN=', '--env', 'TIKTOK_VERIFY_FP=', '--env', 'TIKTOK_TARGET_IDC=',
    '--env', 'WHITELIST_AUTHENTICATED_SESSION_ID_HOST=', '--env', 'DISCORD_REDIRECT_URI=',
    '--env', 'DISCORD_CLIENT_ID=100000000000000001', '--env', 'DISCORD_CLIENT_SECRET=CI_FAKE_DISCORD_SECRET',
    '--env', 'DISCORD_ADMIN_IDS=100000000000000001', image]);
  containerCreated = true;
  docker(['start', container]);
  const published = docker(['port', container, '3000/tcp']);
  assert.match(published, /^127\.0\.0\.1:\d+$/);
  port = Number(published.split(':')[1]);
  await ready();
  await checkHttp();
  assert.equal(docker(['inspect', '--format', '{{.HostConfig.ReadonlyRootfs}}', container]), 'true');
  assert.equal(docker(['inspect', '--format', '{{.HostConfig.NetworkMode}}', container]), network);
  inside(`import assert from 'node:assert/strict'; import {existsSync,writeFileSync} from 'node:fs';
    assert.notEqual(process.getuid(),0);
    assert.equal(existsSync('/app/.env'),false); assert.equal(existsSync('/app/.git'),false);
    assert.throws(()=>writeFileSync('/app/ci-readonly-marker','fake'),error=>['EROFS','EACCES'].includes(error.code));
    writeFileSync('/app/data/ci-public-marker','persistent');`);
  docker(['stop', '--time', '10', container], 20_000);
  assert.equal(docker(['inspect', '--format', '{{.State.ExitCode}}', container]), '0');
  docker(['start', container]);
  port = Number(docker(['port', container, '3000/tcp']).split(':')[1]);
  await ready();
  inside(`import assert from 'node:assert/strict'; import {readFileSync} from 'node:fs';
    assert.equal(readFileSync('/app/data/ci-public-marker','utf8'),'persistent');`);
  console.log('Publieke containercheck geslaagd: bridge, health, OAuth/HTTPS-cookies, Host/origin-gates, non-root/read-only en herstart.');
} finally {
  if (containerCreated) { try { docker(['rm', '--force', container]); } catch { /* Bewaar de oorspronkelijke fout. */ } }
  if (volumeCreated) { try { docker(['volume', 'rm', volume]); } catch { /* Alleen dit testvolume. */ } }
  if (networkCreated) { try { docker(['network', 'rm', network]); } catch { /* Alleen dit testnetwerk. */ } }
}

