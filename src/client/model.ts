import type { Phase } from '../shared/events.js';
import type { Category, FilterSettings } from './filters.js';
import { classify, loadSettings } from './filters.js';
import { displayTime } from './dom.js';
import type { ChatCapabilities } from '../shared/capabilities.js';

export type Page = 'Overzicht' | 'Livechat' | 'Moderatie' | 'Filters' | 'Commands' | 'Toegang' | 'Instellingen';
export interface Message { id: number; user: string; text: string; time: string; resolved: boolean; userId?: string; secUid?: string }
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
  capabilities?: ChatCapabilities;
  moderation?: { connected: boolean; enabled: boolean; mute: boolean; ban: boolean; reason: string };
}

export const state: DashboardState = {
  settings: loadSettings(), messages: [], activity: [], nextId: 1, filter: 'Alle',
  page: 'Livechat', liveMode: true, phase: 'idle', serverConnected: false, username: 'faynominaal'
};

export function addMessage(user: string, text: string, time = displayTime(), identity?: { id?: number; userId?: string; secUid?: string }): void {
  const id = identity?.id && Number.isSafeInteger(identity.id) && identity.id > 0 ? identity.id : state.nextId++;
  state.nextId = Math.max(state.nextId, id + 1);
  state.messages.push({ id, user, text, time, resolved: false, userId: identity?.userId, secUid: identity?.secUid });
  if (state.messages.length > 500) state.messages.shift();
}

export function pending(): Message[] {
  return state.messages.filter(message => !message.resolved && classify(message.text, state.settings));
}

export function resetMessages(): void {
  state.messages = [];
  state.activity = [];
}
