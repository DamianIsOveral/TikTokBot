import type { ChatCapabilities } from '../shared/capabilities.ts';
import type { Connector } from './types.ts';

export interface ChatAccess {
  snapshot(): ChatCapabilities;
  refresh(force?: boolean): Promise<ChatCapabilities>;
  canSend(): boolean;
  close(): void;
}
export type CommandSender = (text: string, connection: Connector, active: () => boolean) => Promise<unknown>;
