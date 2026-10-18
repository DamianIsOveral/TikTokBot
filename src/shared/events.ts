import type { ChatCapabilities } from './capabilities.js';
import type { FilterDocument } from './filter-settings.js';
import type { ModerationFeedbackSnapshot } from './moderation-feedback.js';

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
  displayName?: string;
  avatarUrl?: string;
  text: string;
  userId?: string;
  secUid?: string;
  isBot?: boolean;
  isModerator?:boolean;
}

export interface BotEvent { type: 'bot'; text: string }
export interface ViewerCountEvent { type: 'viewers'; count: number }
export interface CapabilityEvent { type: 'capabilities'; value: ChatCapabilities }
export interface CommandsChangedEvent { type: 'commands-changed'; revision: number }
export interface FiltersChangedEvent { type: 'filters-changed'; value: FilterDocument }
export interface ModerationChangedEvent { type: 'moderation-changed'; value: ModerationFeedbackSnapshot }

export interface ChatEvent extends IncomingChat {
  id: number;
  time: string;
}

export type ActivityKind = 'join' | 'gift' | 'follow' | 'share';
export interface IncomingActivity {
  type: 'activity';
  kind: ActivityKind;
  user: string;
  displayName?: string;
  avatarUrl?: string;
  gift?: string;
  count?: number;
}
export interface ActivityEvent extends IncomingActivity { id: number; time: string }

export interface Snapshot {
  type: 'snapshot';
  mode: Mode;
  phase: Phase;
  text: string;
  messages: ChatEvent[];
  activity?: ActivityEvent[];
  viewerCount?: number;
  filters?: FilterDocument;
  moderation?: ModerationFeedbackSnapshot;
  botStatus?: string;
  capabilities?: ChatCapabilities;
}

export type LiveEvent = StatusEvent | IncomingChat | IncomingActivity | BotEvent | CapabilityEvent | ViewerCountEvent;
export type ServerEvent = StatusEvent | ChatEvent | ActivityEvent | Snapshot | BotEvent | CapabilityEvent | ViewerCountEvent | CommandsChangedEvent | FiltersChangedEvent | ModerationChangedEvent;
export type ClientEvent = ServerEvent | { type: 'transport'; text: string };
export interface PublicConfig { username: string; botUsername: string; botEnabled: boolean }
