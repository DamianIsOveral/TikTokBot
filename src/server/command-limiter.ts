import { commandPolicy as policy } from '../shared/command-policy.ts';

export function createCommandLimiter(now = Date.now) {
  let busy = false;
  let nextSend = 0;
  let nextBatch = 0;
  const history: number[] = [];
  const triggers = new Map<string, number>();
  const users = new Map<string, number>();
  return {
    reserve(count: number, trigger: string, user: string, cooldownSeconds: number) {
      while (history.length && history[0] <= now() - 60_000) history.shift();
      for (const [id, until] of users) if (until <= now()) users.delete(id);
      for (const [id, until] of triggers) if (until <= now()) triggers.delete(id);
      if (busy || count < 1 || count > policy.maxMessages || history.length + count > policy.messagesPerMinute
        || now() < nextBatch || now() < (triggers.get(trigger) || 0) || now() < (users.get(user) || 0)) return;
      busy = true;
      if (triggers.size >= 500) triggers.delete(triggers.keys().next().value!);
      triggers.set(trigger, now() + Math.max(policy.minCooldownSeconds, cooldownSeconds) * 1000);
      if (users.size >= 500) users.delete(users.keys().next().value!);
      users.set(user, now() + policy.userCooldownMs);
      return {
        waitMs: () => Math.max(0, nextSend - now()),
        record: () => { history.push(now()); nextSend = now() + policy.intervalMs; },
        close: () => { busy = false; nextBatch = now() + policy.batchPauseMs; }
      };
    }
  };
}
export type CommandLimiter = ReturnType<typeof createCommandLimiter>;
