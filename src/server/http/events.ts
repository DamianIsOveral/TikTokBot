import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ServerEvent, Snapshot } from '../../shared/events.ts';

export function createEventStream() {
  const clients = new Map<ServerResponse, () => boolean>();
  const frame = (event: ServerEvent) => `data: ${JSON.stringify(event)}\n\n`;
  const heartbeat = setInterval(() => {
    for (const [client, authorized] of clients) {
      if (!authorized()) { client.end(); clients.delete(client); }
      else if (!client.write(': heartbeat\n\n')) client.destroy();
    }
  }, 25_000);
  heartbeat.unref();

  return {
    revalidate(): void {
      for (const [client, authorized] of clients) if (!authorized()) { client.end(); clients.delete(client); }
    },
    broadcast(event: ServerEvent): void {
      for (const [client, authorized] of clients) {
        if (!authorized()) { client.end(); clients.delete(client); }
        else if (!client.write(frame(event))) client.destroy();
      }
    },
    subscribe(req: IncomingMessage, res: ServerResponse, snapshot: Snapshot, authorized: () => boolean): void {
      if (clients.size >= 10) { res.writeHead(503).end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'X-Accel-Buffering': 'no' });
      res.write(frame(snapshot));
      clients.set(res, authorized);
      res.on('close', () => clients.delete(res));
    },
    disconnect(): void {
      for (const client of clients.keys()) client.end();
      clients.clear();
    },
    close(): void {
      clearInterval(heartbeat);
      for (const client of clients.keys()) client.end();
      clients.clear();
    }
  };
}
