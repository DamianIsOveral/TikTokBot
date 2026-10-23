import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { readConfig } from '../src/server/config.ts';
import { createTestApp, signIn, authenticatedFetch } from './auth-fixture.ts';
import { createModerationRoutes } from '../src/server/http/moderation-routes.ts';
import { createAuditStore } from '../src/server/moderation-audit.ts';
import { DirectTikTokError } from '../src/server/tiktok/direct-client.ts';
import type { DirectChat } from '../src/server/tiktok/direct-chat.ts';

test('dashboard moderation reports require authentication, CSRF and an exact safe schema without TikTok requests', async t => {
  const logs: string[] = [];
  t.mock.method(console, 'error', (value: string) => { logs.push(value); });
  const config = readConfig({});
  const app = createTestApp(config);
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  config.port = (app.server.address() as AddressInfo).port;
  t.after(() => app.close());
  const base = `http://127.0.0.1:${config.port}`;
  const request = authenticatedFetch(await signIn(config));
  const url = base + '/api/moderation/errors';
  const headers = { Origin: base, 'X-Requested-With': 'faynominaal', 'Content-Type': 'application/json' };
  const report = { reference: randomUUID(), operation: 'mute', kind: 'invalid-response', status: 502, contentType: 'html', redirected: false };
  const post = (value: unknown) => request(url, { method: 'POST', headers, body: JSON.stringify(value) });
  assert.equal((await fetch(url, { method: 'POST', headers, body: JSON.stringify(report) })).status, 401);
  assert.equal((await request(url, { method: 'POST', headers: { ...headers, Origin: 'https://evil.example' }, body: JSON.stringify(report) })).status, 403);
  assert.equal((await request(url)).status, 405);
  assert.equal(logs.length, 0);
  for (const value of [null, [], { ...report, body: '<!DOCTYPE PRIVATE_COOKIE' }, { ...report, reference: 'PRIVATE_COOKIE' },
    { ...report, operation: 'PRIVATE_USERNAME' }, { ...report, kind: ['network'] }, { ...report, contentType: ['html'] },
    { ...report, status: 600 }, { ...report, status: -1 }, { ...report, status: 1.5 }, { ...report, redirected: 'false' }]) {
    assert.equal((await post(value)).status, 400);
  }
  assert.equal(logs.length, 0);
  const accepted = await post(report);
  assert.equal(accepted.status, 204);
  assert.match(accepted.headers.get('X-Request-ID')!, /^[0-9a-f-]{36}$/);
  assert.equal(await accepted.text(), '');
  const logged = JSON.parse(logs[0]!);
  assert.deepEqual({ ...logged, timestamp: undefined }, { timestamp: undefined, event: 'moderation-request-failed', source: 'dashboard', ...report });
  assert.ok(Number.isFinite(Date.parse(logged.timestamp)));
  assert.doesNotMatch(logs.join(''), /PRIVATE|session|cookie|username/i);
  for (let i = 0; i < 8; i++) assert.equal((await post(report)).status, 204);
  assert.equal((await post(report)).status, 429);
  assert.equal(logs.length, 9);
  t.mock.method(Date, 'now', () => 1e15);
  assert.equal((await post(report)).status, 204);
});

test('server moderation errors correlate response and sanitized log while retaining only safe upstream metadata', async t => {
  const logs: string[] = [];
  t.mock.method(console, 'error', (value: string) => { logs.push(value); });
  const config = readConfig({});
  const error = new DirectTikTokError('response', 502, 1234);
  error.message = 'PRIVATE_COOKIE <!DOCTYPE secret>';
  const direct = { withModeration: async () => { throw error; } } as unknown as DirectChat;
  const route = createModerationRoutes(config, direct, { roomId: 'PRIVATE_ROOM' } as never, {} as never, createAuditStore());
  const server = http.createServer((req, res) => { void route(req, res, { id: 'PRIVATE_ACTOR' } as never, () => true); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const reference = randomUUID();
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/moderation`;
  const response = await fetch(url, { headers: { 'X-Request-ID': reference } });
  assert.equal(response.status, 502);
  const result = await response.json();
  assert.equal(result.reference, response.headers.get('X-Request-ID'));
  assert.equal(result.reference, reference);
  assert.equal(logs.length, 1);
  assert.deepEqual({ ...JSON.parse(logs[0]!), timestamp: undefined }, { timestamp: undefined, source: 'server', event: 'moderation-request-failed',
    reference: result.reference, operation: 'access', status: 502, kind: 'response', upstreamStatus: 502, apiCode: 1234 });
  assert.doesNotMatch(logs.join(''), /PRIVATE|DOCTYPE|secret/);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_COOKIE|DOCTYPE|secret/);
  const invalid = await fetch(url, { headers: { 'X-Request-ID': 'PRIVATE_HEADER' } });
  assert.notEqual(invalid.headers.get('X-Request-ID'), 'PRIVATE_HEADER');
  assert.doesNotMatch(logs.join(''), /PRIVATE_HEADER/);
});
