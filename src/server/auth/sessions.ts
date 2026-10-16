import { createHash, randomBytes } from 'node:crypto';
import type { DiscordIdentity } from './discord.ts';

const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
const token = (): string => randomBytes(32).toString('base64url');
const validToken = (value: string | undefined): value is string => !!value && /^[a-zA-Z0-9_-]{43}$/.test(value);

export function createSessionStore(now = Date.now) {
  const flows = new Map<string, { browser: string; expires: number }>();
  const sessions = new Map<string, { identity: DiscordIdentity; expires: number }>();
  function sweep(): void {
    for (const [key, value] of flows) if (value.expires <= now()) flows.delete(key);
    for (const [key, value] of sessions) if (value.expires <= now()) sessions.delete(key);
  }
  return {
    begin(): { state: string; browser: string } {
      sweep();
      if (flows.size >= 200) throw new Error('Te veel inlogpogingen.');
      const state = token();
      const browser = token();
      flows.set(hash(state), { browser: hash(browser), expires: now() + 10 * 60_000 });
      return { state, browser };
    },
    consume(state: string | undefined, browser: string | undefined): boolean {
      sweep();
      if (!validToken(state) || !validToken(browser)) return false;
      const flow = flows.get(hash(state));
      flows.delete(hash(state));
      return !!flow && flow.browser === hash(browser);
    },
    create(identity: DiscordIdentity): string {
      sweep();
      if (sessions.size >= 500) throw new Error('Te veel actieve sessies.');
      const raw = token();
      sessions.set(hash(raw), { identity: { ...identity }, expires: now() + 8 * 60 * 60_000 });
      return raw;
    },
    get(raw: string | undefined): DiscordIdentity | undefined {
      sweep();
      if (!validToken(raw)) return;
      const session = sessions.get(hash(raw));
      return session ? { ...session.identity } : undefined;
    },
    remove(raw: string | undefined): void { if (validToken(raw)) sessions.delete(hash(raw)); },
    prune(allowed: (id: string) => boolean): void {
      for (const [key, session] of sessions) if (!allowed(session.identity.id)) sessions.delete(key);
    }
  };
}
