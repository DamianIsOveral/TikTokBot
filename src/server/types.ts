import type { TikTokLiveConnection } from 'tiktok-live-connector';

export interface TikTokMessage {
  content?: string;
  comment?: string;
  uniqueId?: string;
  user?: { uniqueId?: string; displayId?: string; idStr?: string; secUid?: string };
}

export type ConnectorOptions = NonNullable<ConstructorParameters<typeof TikTokLiveConnection>[1]>;

export interface Connector {
  readonly roomId?: string;
  on(event: 'chat', listener: (message: TikTokMessage) => void): this;
  on(event: 'error', listener: (error: unknown) => void): this;
  on(event: 'disconnected', listener: () => void): this;
  connect(): Promise<unknown>;
  disconnect(): void | Promise<unknown>;
  sendMessage(text: string): Promise<unknown>;
}

export type ConnectorConstructor = new (username: string, options: ConnectorOptions) => Connector;
export type ConnectorLoader = () => Promise<{ TikTokLiveConnection: ConnectorConstructor }>;
