import type { Phase } from '../shared/events.js';
import type { Category, FilterSettings } from './filters.js';
import { classify, loadSettings } from './filters.js';
import { displayTime } from './dom.js';
import type { ChatCapabilities } from '../shared/capabilities.js';

export type Page = 'Overzicht' | 'Livechat' | 'Moderatie' | 'Filters' | 'Commands' | 'Toegang' | 'Instellingen';
export interface Message { id: number; user: string; text: string; time: string; resolved: boolean }
interface DashboardState {
  settings: FilterSettings;
  messages: Message[];
  activity: string[];
  nextId: number;
  filter: Category | 'Alle';
  page: Page;
  liveMode: boolean;
  phase: Phase;
  username: string;
  capabilities?: ChatCapabilities;
}

export const state: DashboardState = {
  settings: loadSettings(), messages: [], activity: [], nextId: 1, filter: 'Alle',
  page: 'Livechat', liveMode: false, phase: 'idle', username: 'faynominaal'
};

export function addMessage(user: string, text: string, time = displayTime()): void {
  state.messages.push({ id: state.nextId++, user, text, time, resolved: false });
  if (state.messages.length > 500) state.messages.shift();
}

export function pending(): Message[] {
  return state.messages.filter(message => !message.resolved && classify(message.text, state.settings));
}

export function resetMessages(): void {
  state.messages = [];
  state.activity = [];
}
