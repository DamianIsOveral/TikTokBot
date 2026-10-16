import { setTimeout as delay } from 'node:timers/promises';
import type { TikTokMessage } from './types.ts';
import type { CommandDefinition } from '../shared/commands.ts';
import { defaultCommands } from './command-defaults.ts';

interface CommandOptions {
  send: (text: string) => Promise<unknown>;
  active: () => boolean;
  botUsername: string;
  report: (text: string) => void;
  wait?: (ms: number) => Promise<unknown>;
  now?: () => number;
  getCommands?: () => readonly CommandDefinition[];
}

export function createCommands({ send, active, botUsername, report, wait = delay, now = Date.now,
  getCommands = defaultCommands }: CommandOptions) {
  const cooldowns = new Map<string, number>();
  let busy = false;
  let nextSend = 0;
  return async (message: TikTokMessage): Promise<void> => {
    if (!active() || busy) return;
    const user = String(message.user?.displayId || message.user?.uniqueId || '').toLowerCase();
    if (user === botUsername.toLowerCase()) return;
    const command = String(message.content ?? message.comment ?? '').trim().toLowerCase();
    const definition = getCommands().find(item => item.trigger === command && item.enabled);
    if (!definition || now() < (cooldowns.get(command) || 0)) return;
    busy = true;
    cooldowns.set(command, now() + definition.cooldownSeconds * 1000);
    try {
      for (const text of definition.responses) {
        await wait(Math.max(0, nextSend - now()));
        const latest = getCommands().find(item => item.trigger === command);
        if (!active() || JSON.stringify(latest) !== JSON.stringify(definition)) break;
        await send(text);
        nextSend = now() + 1000;
      }
    } catch { report('Botbericht versturen mislukt.'); }
    finally { busy = false; }
  };
}
