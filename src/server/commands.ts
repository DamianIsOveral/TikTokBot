import { setTimeout as delay } from 'node:timers/promises';
import type { TikTokMessage } from './types.ts';
import type { CommandDefinition } from '../shared/commands.ts';
import { defaultCommands } from './command-defaults.ts';
import { messageErrorText } from './message-errors.ts';
import { planResponses } from '../shared/command-policy.ts';
import { createCommandLimiter } from './command-limiter.ts';
import type { CommandLimiter } from './command-limiter.ts';

interface CommandOptions {
  send: (text: string) => Promise<unknown>;
  active: () => boolean;
  botUsername: string;
  report: (text: string) => void;
  wait?: (ms: number) => Promise<unknown>;
  now?: () => number;
  getCommands?: () => readonly CommandDefinition[];
  limiter?: CommandLimiter;
}

export function createCommands({ send, active, botUsername, report, wait = delay, now = Date.now,
  getCommands = defaultCommands, limiter = createCommandLimiter(now) }: CommandOptions) {
  return async (message: TikTokMessage): Promise<void> => {
    if (!active()) return;
    const user = String(message.user?.displayId || message.user?.uniqueId || '').toLowerCase().slice(0, 100);
    if (user === botUsername.toLowerCase()) return;
    const command = String(message.content ?? message.comment ?? '').trim().toLowerCase();
    const definition = getCommands().find(item => item.trigger === command && item.enabled);
    if (!definition) return;
    const plan = planResponses(definition.responses);
    if (plan.error) { report(`Commando overgeslagen: ${plan.error}`); return; }
    const ticket = limiter.reserve(plan.messages.length, command, user, definition.cooldownSeconds);
    if (!ticket) return;
    try {
      for (const text of plan.messages) {
        await wait(ticket.waitMs());
        const latest = getCommands().find(item => item.trigger === command);
        if (!active() || JSON.stringify(latest) !== JSON.stringify(definition)) break;
        try { await send(text); } finally { ticket.record(); }
      }
    } catch (error) { report(messageErrorText(error)); }
    finally { ticket.close(); }
  };
}
