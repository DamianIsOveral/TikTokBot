export function createSession(publish, limit = 500) {
  let mode = 'demo';
  let status = 'Niet verbonden';
  let phase = 'idle';
  let nextId = 1;
  let messages = [];

  function receive(event) {
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

  function snapshot() {
    return { type: 'snapshot', mode, phase, text: status,
      messages: messages.map(message => ({ ...message })) };
  }

  return { receive, snapshot };
}
