import type { Mode, Phase, ChatEvent, ActivityEvent, LiveEvent, ServerEvent, Snapshot } from '../shared/events.ts';
import type { ChatCapabilities } from '../shared/capabilities.ts';
import type { FilterDocument } from '../shared/filter-settings.ts';

export function createSession(publish: (event: ServerEvent) => void, limit = 500, getFilters?: () => FilterDocument) {
  let mode: Mode = 'live';
  let status = 'Niet verbonden';
  let phase: Phase = 'idle';
  let nextId = 1;
  let messages: ChatEvent[] = [];
  let activity: ActivityEvent[] = [];
  let botStatus: string | undefined;
  let capabilities: ChatCapabilities | undefined;

  function receive(event: LiveEvent): void {
    if (event.type === 'capabilities') {
      capabilities = { ...event.value };
      publish(event);
    } else if (event.type === 'status') {
      status = event.text;
      phase = event.phase || phase;
      if (event.phase === 'connecting') {
        mode = 'live';
        messages = [];
        activity = [];
        botStatus = undefined;
      }
      if (['idle', 'stopped', 'disconnected', 'error'].includes(event.phase || '')) { messages = []; activity = []; }
      publish({ ...event, phase, mode });
    } else if (event.type === 'bot') {
      botStatus = event.text;
      publish(event);
    } else if (event.type === 'activity') {
      const item = { ...event, id: nextId++, time: new Date().toISOString() };
      activity.push(item);
      if (activity.length > 100) activity.shift();
      publish(item);
    } else if (event.type === 'chat') {
      const message = { ...event, id: nextId++, time: new Date().toISOString() };
      messages.push(message);
      if (messages.length > limit) messages.shift();
      publish(message);
    }
  }

  function snapshot(): Snapshot {
    return { type: 'snapshot', mode, phase, text: status,
      messages: messages.map(message => ({ ...message })), activity: activity.map(item => ({ ...item })),
      ...(getFilters ? { filters: getFilters() } : {}),
      botStatus, capabilities: capabilities && { ...capabilities } };
  }

  return { receive, snapshot };
}
