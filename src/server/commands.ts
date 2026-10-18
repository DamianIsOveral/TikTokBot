import { setTimeout as delay } from 'node:timers/promises';
import type { TikTokMessage } from './types.ts';
import type { CommandDefinition, CommandLimits } from '../shared/commands.ts';
import { defaultCommands } from './command-defaults.ts';
import { messageErrorText } from './message-errors.ts';
import { defaultCommandLimits, planResponses } from '../shared/command-policy.ts';
import { renderCommandTemplates } from '../shared/command-templates.ts';
import { mayTriggerCommand } from './command-audience.ts';
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
  channel?: string;
  getLimits?: () => CommandLimits;
  signal?: AbortSignal;
}

export function createCommands({ send, active, botUsername, report, signal, wait = ms => delay(ms,undefined,{signal}), now = Date.now,
  getCommands = defaultCommands, channel='kanaal', getLimits = () => defaultCommandLimits,
  limiter = createCommandLimiter(now,getLimits) }: CommandOptions) {
  return async (message: TikTokMessage): Promise<void> => {
    if (!active() || signal?.aborted) return;
    const user = String(message.user?.displayId || message.user?.uniqueId || '').toLowerCase().slice(0, 100);
    if (user === botUsername.toLowerCase()) return;
    const command = String(message.content ?? message.comment ?? '').trim().toLowerCase();
    const definition = getCommands().find(item => item.enabled && (item.trigger === command || item.aliases?.includes(command)));
    if (!definition) return;
    if(!mayTriggerCommand(definition.audience,message,channel))return;
    const username=String(message.user?.uniqueId||message.user?.displayId||'kijker');
    const rendered=renderCommandTemplates(definition.responses,{username,
      displayname:typeof message.user?.nickname==='string'?message.user.nickname:username,channel,command:definition.trigger});
    if(rendered.error){report(rendered.error);return;}
    const plan = planResponses(rendered.responses,getLimits());
    if (plan.error) { report(`Commando overgeslagen: ${plan.error}`); return; }
    const ticket = limiter.reserve(plan.messages.length, definition.trigger, user, definition.cooldownSeconds);
    if (!ticket) return;
    try {
      for (const text of plan.messages) {
        await wait(ticket.waitMs());
        while(active() && !signal?.aborted && ticket.waitMs()>0)await wait(ticket.waitMs());
        const latest = getCommands().find(item => item.trigger === definition.trigger);
        if (!active() || signal?.aborted || !ticket.canSend() || JSON.stringify(latest) !== JSON.stringify(definition)) break;
        try { await send(text); } finally { ticket.record(); }
      }
    } catch (error) { if(!signal?.aborted)report(messageErrorText(error)); }
    finally { ticket.close(); }
  };
}
