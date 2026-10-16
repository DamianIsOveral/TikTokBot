import type { ConnectorConstructor, ConnectorLoader } from './types.ts';

export const loadConnector: ConnectorLoader = async () => {
  const { TikTokLiveConnection } = await import('tiktok-live-connector');
  const prototype: unknown = TikTokLiveConnection.prototype;
  if (!prototype || typeof prototype !== 'object' || !('on' in prototype) || typeof prototype.on !== 'function') {
    throw new Error('TikTok-connector ondersteunt geen events.');
  }
  // De SDK-types missen onder NodeNext de overgeërfde eventmethoden.
  return { TikTokLiveConnection: TikTokLiveConnection as unknown as ConnectorConstructor };
};
