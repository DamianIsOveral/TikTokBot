import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionCookies } from '../src/server/tiktok/session-cookies.ts';

test('botsessiecookies volgen ontvangen rotatie en expiry; onbekende cookies worden genegeerd', () => {
  let time = Date.parse('2026-10-17T00:00:00Z');
  const jar = createSessionCookies([['msToken', 'BOOTSTRAP_TOKEN'], ['s_v_web_id', 'verify_BOOTSTRAP']], () => time);
  const headers = new Headers();
  headers.append('Set-Cookie', 'msToken=ROTATED_TOKEN; Max-Age=10; Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  headers.append('Set-Cookie', 's_v_web_id=verify_ROTATED; Expires=Sat, 17 Oct 2026 00:00:20 GMT');
  headers.append('Set-Cookie', 'unrelated_tracking=ignored; Max-Age=100');
  jar.absorb(headers);
  assert.equal(jar.cookies.get('msToken'), 'ROTATED_TOKEN');
  assert.equal(jar.cookies.get('s_v_web_id'), 'verify_ROTATED');
  assert.equal(jar.cookies.has('unrelated_tracking'), false);
  time += 10_000;
  jar.prune();
  assert.equal(jar.cookies.has('msToken'), false);
  assert.equal(jar.cookies.has('s_v_web_id'), true);
  time += 10_000;
  jar.prune();
  assert.equal(jar.cookies.size, 0);
});

test('cookieverwijdering wist oude waarden en een sessiecookie vervangt oude expiry', () => {
  let time = 1700000000000;
  const jar = createSessionCookies([['msToken', 'BOOTSTRAP']], () => time);
  jar.absorb(new Headers({ 'Set-Cookie': 'msToken=expired; Max-Age=0' }));
  assert.equal(jar.cookies.has('msToken'), false);
  jar.absorb(new Headers({ 'Set-Cookie': 'msToken=TEMPORARY; Max-Age=1' }));
  jar.absorb(new Headers({ 'Set-Cookie': 'msToken=SESSION_ONLY; HttpOnly; Secure' }));
  time += 2000;
  jar.prune();
  assert.equal(jar.cookies.get('msToken'), 'SESSION_ONLY');
  jar.absorb(new Headers({ 'Set-Cookie': 'msToken=; Secure' }));
  assert.equal(jar.cookies.has('msToken'), false);
});
