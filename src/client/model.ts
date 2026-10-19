import type { Phase } from '../shared/events.js';
import type { Category, FilterSettings } from './filters.js';
import { automaticCategory, loadSettings } from './filters.js';
import { displayTime } from './dom.js';
import type { ChatCapabilities } from '../shared/capabilities.js';

export type Page = 'Overzicht' | 'Livechat' | 'Moderatie' | 'Filters' | 'Commands' | 'Toegang' | 'Instellingen';
export interface Message { id: number; user: string; displayName?:string; avatarUrl?:string; text: string; time: string; resolved: boolean; reviewDuration?:number; manualReview?: boolean; userId?: string; secUid?: string; isBot?: boolean;isModerator?:boolean }
interface DashboardState {
  settings: FilterSettings;
  messages: Message[];
  activity: string[];
  nextId: number;
  filter: Category | 'Alle';
  page: Page;
  liveMode: boolean;
  phase: Phase;
  serverConnected: boolean;
  username: string;
  botUsername: string;
  menuMessageId?: number;
  capabilities?: ChatCapabilities;
  moderation?: { connected: boolean; enabled: boolean; mute: boolean; ban: boolean; reason: string };
}

export const state: DashboardState = {
  settings: loadSettings(), messages: [], activity: [], nextId: 1, filter: 'Alle',
  page: 'Livechat', liveMode: true, phase: 'idle', serverConnected: false, username: 'faynominaal',botUsername:''
};

export function addMessage(user: string, text: string, time = displayTime(), identity?: { id?: number; displayName?:string; avatarUrl?:string; userId?: string; secUid?: string; isBot?:boolean;isModerator?:boolean }): void {
  const id = identity?.id && Number.isSafeInteger(identity.id) && identity.id > 0 ? identity.id : state.nextId++;
  state.nextId = Math.max(state.nextId, id + 1);
  state.messages.push({ id, user, displayName:identity?.displayName, avatarUrl:identity?.avatarUrl, text, time, resolved: false, userId: identity?.userId, secUid: identity?.secUid,isBot:identity?.isBot===true,isModerator:identity?.isModerator===true });
  if (state.messages.length > 500) state.messages.shift();
}

export function pending(): Message[] {
  return state.messages.filter(message => !message.resolved && (message.manualReview || automaticCategory(message, state.settings)));
}

export function resetMessages(): void {
  state.messages = [];
  state.activity = [];
}
