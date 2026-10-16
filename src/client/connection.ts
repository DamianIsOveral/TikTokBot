import type { ClientEvent, PublicConfig, ServerEvent } from '../shared/events.js';

export function createConnection(onEvent: (event: ClientEvent) => void) {
  let stream: EventSource | undefined;
  function subscribe(): void {
    stream?.close();
    stream = new EventSource('/api/events');
    stream.onmessage = event => onEvent(JSON.parse(event.data) as ServerEvent);
    stream.onerror = () => onEvent({ type: 'transport', text: 'Serververbinding onderbroken. Opnieuw verbinden…' });
  }
  async function request(action: 'connect' | 'stop'): Promise<void> {
    const response = await fetch(`/api/${action}`, {
      method: 'POST', headers: { 'X-Requested-With': 'faynominaal' }
    });
    if (!response.ok) throw new Error('Serveractie mislukt.');
  }
  return {
    subscribe,
    async connect(): Promise<void> { await request('connect'); subscribe(); },
    stop: () => request('stop'),
    async config(): Promise<PublicConfig> {
      const response = await fetch('/api/config');
      if (!response.ok) throw new Error('Serverinstellingen ophalen mislukt.');
      return response.json() as Promise<PublicConfig>;
    }
  };
}
