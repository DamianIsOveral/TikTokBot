import type { Mode, Phase, ChatEvent, LiveEvent, ServerEvent, Snapshot } from '../shared/events.ts';

export function createSession(publish: (event: ServerEvent) => void, limit = 500) {
  let mode: Mode = 'demo';
  let status = 'Niet verbonden';
  let phase: Phase = 'idle';
  let nextId = 1;
  let messages: ChatEvent[] = [];

  function receive(event: LiveEvent): void {
    if (event.type === 'status') {
      status = event.text;
      phase = event.phase || phase;
      if (event.phase === 'connecting') {
        mode = 'live';
        messages = [];
      }
      publish({ ...event, phase, mode });
    } else if (event.type === 'chat') {
      const message = { ...event, id: nextId++, time: new Date().toISOString() };
      messages.push(message);
      if (messages.length > limit) messages.shift();
      publish(message);
    }
  }

  function snapshot(): Snapshot {
    return { type: 'snapshot', mode, phase, text: status,
      messages: messages.map(message => ({ ...message })) };
  }

  return { receive, snapshot };
}
