import { commandPolicy as policy, defaultCommandLimits } from '../shared/command-policy.ts';
import type { CommandLimits } from '../shared/commands.ts';

export function createCommandLimiter(now = Date.now, getLimits: () => CommandLimits = () => defaultCommandLimits) {
  let busy = false;
  let lastSend = -Infinity;
  let nextBatch = 0;
  const history: number[] = [];
  const triggers = new Map<string, number>();
  const users = new Map<string, number>();
  const prune = () => { while (history.length && history[0] <= now() - 3600_000) history.shift(); };
  const withinBudget = (count: number) => {
    prune();
    return history.length + count <= getLimits().maxMessagesPerHour
      && history.filter(at=>at>now()-60_000).length+count<=policy.messagesPerMinute;
  };
  const waitMs = () => Math.max(0,lastSend+getLimits().intervalSeconds*1000-now());
  return {
    reserve(count: number, trigger: string, user: string, cooldownSeconds: number) {
      for (const [id, until] of users) if (until <= now()) users.delete(id);
      for (const [id, until] of triggers) if (until <= now()) triggers.delete(id);
      if (busy || count < 1 || count > policy.maxMessages || !withinBudget(count) || waitMs()>0
        || now() < nextBatch || now() < (triggers.get(trigger) || 0) || now() < (users.get(user) || 0)) return;
      busy = true;
      if (triggers.size >= 500) triggers.delete(triggers.keys().next().value!);
      triggers.set(trigger, now() + Math.max(policy.minCooldownSeconds, cooldownSeconds) * 1000);
      if (users.size >= 500) users.delete(users.keys().next().value!);
      users.set(user, now() + policy.userCooldownMs);
      return {
        waitMs,
        canSend: () => withinBudget(1),
        record: () => { history.push(now()); lastSend = now(); },
        close: () => { busy = false; nextBatch = now() + policy.batchPauseMs; }
      };
    }
  };
}
export type CommandLimiter = ReturnType<typeof createCommandLimiter>;
