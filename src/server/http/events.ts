import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ServerEvent, Snapshot } from '../../shared/events.ts';

export function createEventStream() {
  const clients = new Set<ServerResponse>();
  const frame = (event: ServerEvent) => `data: ${JSON.stringify(event)}\n\n`;
  const heartbeat = setInterval(() => {
    for (const client of clients) if (!client.write(': heartbeat\n\n')) client.destroy();
  }, 25_000);
  heartbeat.unref();

  return {
    broadcast(event: ServerEvent): void {
      for (const client of clients) if (!client.write(frame(event))) client.destroy();
    },
    subscribe(req: IncomingMessage, res: ServerResponse, snapshot: Snapshot): void {
      if (clients.size >= 10) { res.writeHead(503).end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'X-Accel-Buffering': 'no' });
      res.write(frame(snapshot));
      clients.add(res);
      res.on('close', () => clients.delete(res));
    },
    close(): void {
      clearInterval(heartbeat);
      for (const client of clients) client.end();
      clients.clear();
    }
  };
}
