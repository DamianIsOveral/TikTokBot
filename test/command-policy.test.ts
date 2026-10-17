import test from 'node:test';
import assert from 'node:assert/strict';
import { planResponses } from '../src/shared/command-policy.ts';
import { createCommandLimiter } from '../src/server/command-limiter.ts';
import { createCommands } from '../src/server/commands.ts';

test('lange antwoorden splitsen zonder links, woorden of Unicodeparen te beschadigen', () => {
  const source = `${'a'.repeat(200)} ${'😀'.repeat(101)} https://example.invalid/test`;
  const plan = planResponses([source]);
  assert.equal(plan.error, '');
  assert.ok(plan.messages.every(text => text.length <= 200 && text === text.trim()));
  assert.equal(plan.messages[0], 'a'.repeat(200));
  assert.ok(plan.messages.every(text => !/[\uD800-\uDBFF]$|^[\uDC00-\uDFFF]/.test(text)));
  assert.ok(plan.messages.at(-1)?.includes('https://example.invalid/test'));
  assert.equal(planResponses(['https://example.invalid/' + 'x'.repeat(200)]).messages.length, 0);
  assert.ok(planResponses(Array(7).fill('regel')).error);
  assert.ok(planResponses(['x'.repeat(1201)]).error);
});

test('globaal berichtbudget weigert een volledige batch als die niet past, zonder wachtrij of gedeeltelijke verzending', async () => {
  let time = 100_000;
  const sent: string[] = [];
  const commands = [{ trigger: '!a', responses: Array(6).fill('A'), enabled: true, cooldownSeconds: 5 },
    { trigger: '!b', responses: Array(5).fill('B'), enabled: true, cooldownSeconds: 5 }];
  const process = createCommands({ active: () => true, botUsername: 'bot', report: assert.fail,
    getCommands: () => commands, now: () => time, wait: async ms => { time += ms; }, send: async text => { sent.push(text); } });
  await process({ content: '!a', user: { uniqueId: 'one' } });
  time += 11_000;
  await process({ content: '!b', user: { uniqueId: 'two' } });
  assert.equal(sent.length, 6);
  time += 61_000;
  await process({ content: '!b', user: { uniqueId: 'two' } });
  assert.equal(sent.length, 11);
});

test('batchpauze, gebruikerscooldown en limiter blijven gelden over nieuwe commandhandlers heen', () => {
  let time = 100_000;
  const limiter = createCommandLimiter(() => time);
  const batch = limiter.reserve(1, '!a', 'viewer', 5)!;
  assert.ok(batch);
  assert.equal(limiter.reserve(1, '!b', 'other', 5), undefined);
  batch.record(); batch.close();
  time += 9000;
  assert.equal(limiter.reserve(1, '!b', 'other', 5), undefined);
  time += 2000;
  assert.equal(limiter.reserve(1, '!b', 'viewer', 5), undefined);
  assert.equal(limiter.reserve(1, '!a', 'other', 5), undefined);
  time += 20_000;
  assert.ok(limiter.reserve(1, '!a', 'viewer', 5));
});
