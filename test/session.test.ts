import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createSession } from '../src/server/session.ts';
import { createTestApp as createApp, signIn, authenticatedFetch } from './auth-fixture.ts';
import { readConfig } from '../src/server/config.ts';

test('sessie bewaart maximaal 500 berichten en start een nieuwe chat bij verbinden', () => {
  const session = createSession(() => {});
  assert.equal(session.snapshot().mode, 'live');
  assert.equal(session.snapshot().messages.length, 0);
  session.receive({ type: 'status', phase: 'connecting', text: 'Verbinden' });
  session.receive({ type: 'status', phase: 'connected', text: 'Verbonden' });
  for (let i = 0; i < 510; i++) session.receive({ type: 'chat', user: 'tester', text: String(i) });
  const snapshot = session.snapshot();
  assert.equal(snapshot.messages.length, 500);
  assert.equal(snapshot.messages[0].text, '10');
  assert.equal(snapshot.messages.at(-1)!.id, 510);
  snapshot.messages[0].text = 'gewijzigd';
  assert.equal(session.snapshot().messages[0].text, '10');
  session.receive({ type: 'status', phase: 'stopped', text: 'Gestopt' });
  assert.equal(session.snapshot().messages.length, 0);
  assert.equal(session.snapshot().mode, 'live');
  session.receive({ type: 'status', phase: 'connecting', text: 'Verbinden' });
  assert.equal(session.snapshot().messages.length, 0);
});

test('SSE levert bestaande chat na vernieuwen en stuurt nieuwe chat naar beide tabs', { timeout: 5000 }, async t => {
  let connector!: Fake;
  let connections = 0;
  class Fake extends EventEmitter {
    constructor() { super(); connector = this; }
    async connect() { connections++; }
    async disconnect() {}
    async sendMessage() {}
  }
  const config = readConfig({});
  const app = createApp(config, async () => ({ TikTokLiveConnection: Fake }));
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  config.port = (app.server.address() as import('node:net').AddressInfo).port;
  t.after(() => app.close());
  const base = `http://127.0.0.1:${config.port}`;
  const fetch = authenticatedFetch(await signIn(config));
  const post = (action: string) => fetch(`${base}/api/${action}`, { method: 'POST',
    headers: { Origin: base, 'X-Requested-With': 'faynominaal' } });
  await post('connect');
  connector.emit('chat', { user: { uniqueId: 'tester' }, content: '<script>tekst</script>' });

  async function openTab() {
    const controller = new AbortController();
    t.after(() => controller.abort());
    const response = await fetch(`${base}/api/events`, { signal: controller.signal });
    const reader = response.body!.getReader();
    let buffer = '';
    return async () => {
      while (!buffer.includes('\n\n')) {
        const result = await reader.read();
        if (result.done) throw new Error('SSE voortijdig gesloten');
        buffer += new TextDecoder().decode(result.value);
      }
      const end = buffer.indexOf('\n\n');
      const frame = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      return JSON.parse(frame.slice('data: '.length));
    };
  }
  const first = await openTab();
  const snapshot = await first();
  assert.equal(snapshot.type, 'snapshot');
  assert.equal(snapshot.phase, 'connected');
  assert.equal(snapshot.messages[0].text, '<script>tekst</script>');
  const second = await openTab();
  assert.deepEqual(await second(), snapshot);
  await post('connect');
  assert.equal(connections, 1);
  connector.emit('chat', { user: { uniqueId: 'tweede' }, content: 'Nieuw bericht' });
  const incoming = await first();
  assert.equal(incoming.type, 'chat');
  assert.equal(incoming.text, 'Nieuw bericht');
  assert.deepEqual(await second(), incoming);
  await post('stop');
  assert.equal((await first()).phase, 'stopped');
  assert.equal((await second()).phase, 'stopped');
});
