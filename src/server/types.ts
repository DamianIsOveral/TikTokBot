import type { TikTokLiveConnection } from 'tiktok-live-connector';

export interface TikTokMessage {
  content?: string;
  comment?: string;
  uniqueId?: string;
  userIdentity?: { isAnchor?: boolean; isModeratorOfAnchor?: boolean; isSubscriberOfAnchor?: boolean };
  user?: { uniqueId?: string; displayId?: string; nickname?: string; id?: string; idStr?: string; secUid?: string;
    userAttr?: { isAdmin?: boolean }; badgeList?: {sceneType?: number; image?: {urlList?:string[]}; combine?: {icon?:{urlList?:string[]}}}[] };
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
