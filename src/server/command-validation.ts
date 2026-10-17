import type { CommandDocument, CommandDefinition } from '../shared/commands.ts';
import { planResponses } from '../shared/command-policy.ts';

export class CommandError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

export function validateCommands(value: unknown): CommandDocument {
  if (!value || typeof value !== 'object') throw new CommandError('Ongeldige commandoconfiguratie.');
  const document = value as Record<string, unknown>;
  if (!Number.isSafeInteger(document.revision) || Number(document.revision) < 0) throw new CommandError('Ongeldige revisie.');
  if (!Array.isArray(document.commands) || document.commands.length > 50) throw new CommandError('Maximaal 50 commando’s toegestaan.');
  const triggers = new Set<string>();
  const commands: CommandDefinition[] = document.commands.map((item: unknown, index) => {
    if (!item || typeof item !== 'object') throw new CommandError(`Commando ${index + 1} is ongeldig.`);
    const row = item as Record<string, unknown>;
    const trigger = typeof row.trigger === 'string' ? row.trigger.trim().toLowerCase() : '';
    if (!/^![a-z0-9_]{1,30}$/.test(trigger)) throw new CommandError('Gebruik een ! gevolgd door 1–30 letters, cijfers of underscores.');
    if (triggers.has(trigger)) throw new CommandError(`Dubbel commando: ${trigger}.`);
    triggers.add(trigger);
    if (row.aliases !== undefined && (!Array.isArray(row.aliases) || row.aliases.length > 10)) {
      throw new CommandError(`Gebruik maximaal 10 aliases voor ${trigger}.`);
    }
    const aliases = ((row.aliases || []) as unknown[]).map(value => {
      const alias = typeof value === 'string' ? value.trim().toLowerCase() : '';
      if (!/^![a-z0-9_]{1,30}$/.test(alias)) throw new CommandError(`Ongeldige alias voor ${trigger}; gebruik ! gevolgd door 1–30 letters, cijfers of underscores.`);
      if (triggers.has(alias)) throw new CommandError(`Dubbel commando of alias: ${alias}.`);
      triggers.add(alias);
      return alias;
    });
    if (typeof row.enabled !== 'boolean') throw new CommandError(`Aan/uit-instelling ontbreekt voor ${trigger}.`);
    if (!Number.isInteger(row.cooldownSeconds) || Number(row.cooldownSeconds) < 5 || Number(row.cooldownSeconds) > 3600) {
      throw new CommandError(`Cooldown voor ${trigger} moet tussen 5 en 3600 seconden liggen.`);
    }
    if (!Array.isArray(row.responses) || row.responses.length < 1 || row.responses.length > 10) {
      throw new CommandError(`${trigger} vereist 1–10 antwoordregels.`);
    }
    const responses = row.responses.map((text: unknown) => {
      if (typeof text !== 'string' || !text.trim() || text.length > 1200 || /[\r\n\u0000-\u001f]/.test(text)) {
        throw new CommandError(`Elke invoerregel van ${trigger} moet 1–1200 tekens bevatten, zonder regeleinden.`);
      }
      return text.trim();
    });
    const plan = planResponses(responses);
    if (plan.error) throw new CommandError(`${trigger}: ${plan.error}`);
    return { trigger, ...(aliases.length ? { aliases } : {}), responses, cooldownSeconds: Number(row.cooldownSeconds), enabled: row.enabled };
  });
  return { revision: Number(document.revision), commands };
}
