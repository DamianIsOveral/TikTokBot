import { setTimeout as delay } from 'node:timers/promises';
import type { TikTokMessage } from './types.ts';

const replies = new Map([
  ['!discord', ['Join de Faynominaal Discord! https://discord.gg/wgPqNe7xn']],
  ['!socials', [
    'Website: https://faynominaal.netlify.app/',
    'Instagram: https://www.instagram.com/faynominaal/',
    'TikTok: https://www.tiktok.com/@faynominaal',
    'YouTube: https://www.youtube.com/@faynominaal',
    'Twitch: https://www.twitch.tv/faynominaal',
    'Snapchat: https://www.snapchat.com/@faynominaal'
  ]],
  ['!dono', ['Wil je de stream steunen? https://www.tipeeestream.com/faynominaal/donation']]
]);

interface CommandOptions {
  send: (text: string) => Promise<unknown>;
  active: () => boolean;
  botUsername: string;
  report: (text: string) => void;
  wait?: (ms: number) => Promise<unknown>;
  now?: () => number;
}

export function createCommands({ send, active, botUsername, report, wait = delay, now = Date.now }: CommandOptions) {
  const cooldowns = new Map<string, number>();
  let busy = false;
  let nextSend = 0;
  return async (message: TikTokMessage): Promise<void> => {
    if (!active() || busy) return;
    const user = String(message.user?.displayId || message.user?.uniqueId || '').toLowerCase();
    if (user === botUsername.toLowerCase()) return;
    const command = String(message.content ?? message.comment ?? '').trim().toLowerCase();
    const texts = replies.get(command);
    if (!texts || now() < (cooldowns.get(command) || 0)) return;
    busy = true;
    cooldowns.set(command, now() + 60_000);
    try {
      for (const text of texts) {
        await wait(Math.max(0, nextSend - now()));
        if (!active()) break;
        await send(text);
        nextSend = now() + 1000;
      }
    } catch { report('Botbericht versturen mislukt.'); }
    finally { busy = false; }
  };
}
