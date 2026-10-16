import type { EulerCapabilities } from './capabilities.js';

export type Phase = 'idle' | 'connecting' | 'connected' | 'stopped' | 'disconnected' | 'error';
export type Mode = 'demo' | 'live';

export interface StatusEvent {
  type: 'status';
  text: string;
  phase?: Phase;
  mode?: Mode;
}

export interface IncomingChat {
  type: 'chat';
  user: string;
  text: string;
}

export interface BotEvent { type: 'bot'; text: string }
export interface CapabilityEvent { type: 'capabilities'; value: EulerCapabilities }

export interface ChatEvent extends IncomingChat {
  id: number;
  time: string;
}

export interface Snapshot {
  type: 'snapshot';
  mode: Mode;
  phase: Phase;
  text: string;
  messages: ChatEvent[];
  botStatus?: string;
  capabilities?: EulerCapabilities;
}

export type LiveEvent = StatusEvent | IncomingChat | BotEvent | CapabilityEvent;
export type ServerEvent = StatusEvent | ChatEvent | Snapshot | BotEvent | CapabilityEvent;
export type ClientEvent = ServerEvent | { type: 'transport'; text: string };
export interface PublicConfig { username: string; botEnabled: boolean }
