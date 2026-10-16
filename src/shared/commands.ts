import type { EulerCapabilities } from './capabilities.js';

export interface CommandDefinition {
  trigger: string;
  responses: string[];
  cooldownSeconds: number;
  enabled: boolean;
}

export interface CommandDocument {
  revision: number;
  commands: CommandDefinition[];
}

export interface CommandSettings extends CommandDocument { botEnabled: boolean; capabilities: EulerCapabilities }
