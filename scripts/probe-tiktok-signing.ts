import { createHeadlessSigner } from '../src/server/tiktok/headless-signer.ts';
import { signingFields, signingSdkVersion, signingUserAgent } from '../src/server/tiktok/signing-profile.ts';

try {
  if (process.argv.length !== 2) throw new Error();
  const started = performance.now();
  const sign = await createHeadlessSigner();
  const payload = { room_id: '7300000000000000001', content: 'OfflineTest', emotes_with_index: '', input_type: 0,
    client_start_timestamp_millisecond: Date.now() };
  const query = new URLSearchParams({ aid: '1988', app_name: 'tiktok_web' });
  for (const [key, value] of Object.entries(payload)) query.set(key, String(value));
  const input = { url: `https://webcast.tiktok.com/webcast/room/chat/?${query}`, userAgent: signingUserAgent,
    method: 'POST' as const, body: JSON.stringify(payload) };
  const results = [await sign(input), await sign(input)];
  console.log(JSON.stringify({ offline: true, sent: false, scriptVersion: signingSdkVersion,
    signingAdapter: 'upstream-bootstrap-post', bodyFields: Object.keys(payload),
    signatureFields: signingFields.filter(name => new URL(results[0].signedUrl).searchParams.has(name)),
    freshSignatures: results[0].signedUrl !== results[1].signedUrl,
    signMs: results.map(result => Math.round(result.signMs)),
    rssMiB: results.map(result => Math.round(result.rssMiB)),
    totalMs: Math.round(performance.now() - started)
  }));
} catch {
  console.log('Lokale ondertekeningsproef mislukt; er is geen TikTok-actie uitgevoerd.');
  process.exitCode = 1;
}
