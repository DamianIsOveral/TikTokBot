import type { ChatCapabilities } from './capabilities.js';

export interface CommandDefinition {
  trigger: string;
  aliases?: string[];
  responses: string[];
  cooldownSeconds: number;
  enabled: boolean;
  audience?: 'everyone' | 'moderators' | 'subscribers' | 'supporters';
}

export interface CommandLimits { intervalSeconds: number; maxMessagesPerHour: number }

export interface CommandDocument {
  revision: number;
  commands: CommandDefinition[];
  limits?: CommandLimits;
}

export interface CommandSettings extends CommandDocument { botEnabled: boolean; capabilities: ChatCapabilities }
