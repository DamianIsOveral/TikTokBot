import { readConfig } from '../src/server/config.ts';
import { loadConnector } from '../src/server/connector.ts';
import { createDirectClient, DirectTikTokError, directErrorText } from '../src/server/tiktok/direct-client.ts';
import type { TikTokLiveConnection as SdkConnection } from 'tiktok-live-connector';
import type { Connector } from '../src/server/types.ts';

const args = process.argv.slice(2);
if (args.some(arg => arg !== '--send-once') || args.length > 1) {
  throw new Error('Gebruik probe-tiktok.ts [--send-once]. Zonder vlag wordt niets verstuurd.');
}
const config = readConfig();
const direct = createDirectClient({ sessionId: process.env.TIKTOK_SESSION_ID || '',
  targetIdc: process.env.TIKTOK_TARGET_IDC || '', botUsername: config.botUsername });
try {
  await direct.verifyIdentity();
  console.log('Botsessie geldig en accountnaam gecontroleerd.');
  if (args.includes('--send-once')) {
    const { TikTokLiveConnection } = await loadConnector();
    const connection = new TikTokLiveConnection(config.username, config.options) as Connector & Pick<SdkConnection, 'roomId'>;
    connection.on('error', () => {});
    const content = `Botverbindingstest ${new Date().toISOString().slice(11, 19)} UTC`;
    let observed = false;
    connection.on('chat', data => {
      const user = String(data.user?.uniqueId || data.user?.displayId || '').toLowerCase();
      if (user === config.botUsername.toLowerCase() && (data.content ?? data.comment) === content) observed = true;
    });
    try {
      await connection.connect();
      const result = await direct.sendMessage(connection.roomId, config.username, content);
      await new Promise(resolve => setTimeout(resolve, 5000));
      console.log(JSON.stringify({ accepted: true, hasMessageId: !!result.messageId, observedInChat: observed }));
    } finally { try { await connection.disconnect(); } catch {} }
  }
} catch (error) {
  console.log(JSON.stringify({ accepted: false, message: directErrorText(error),
    kind: error instanceof DirectTikTokError ? error.kind : 'network',
    http: error instanceof DirectTikTokError ? error.status : undefined,
    apiCode: error instanceof DirectTikTokError ? error.apiCode : undefined }));
  process.exitCode = 1;
}
