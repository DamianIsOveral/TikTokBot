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
}

export type LiveEvent = StatusEvent | IncomingChat;
export type ServerEvent = StatusEvent | ChatEvent | Snapshot;
export type ClientEvent = ServerEvent | { type: 'transport'; text: string };
export interface PublicConfig { username: string; botEnabled: boolean }
