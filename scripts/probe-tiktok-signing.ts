import { createHeadlessSigner } from '../src/server/tiktok/headless-signer.ts';
import { signingFields, signingSdkVersion, signingUserAgent } from '../src/server/tiktok/signing-profile.ts';

try {
  if (process.argv.length !== 2) throw new Error();
  const started = performance.now();
  const sign = await createHeadlessSigner();
  const input = { url: 'https://webcast.tiktok.com/webcast/room/chat/?aid=1988&app_name=tiktok_web&room_id=7300000000000000001&content=OfflineTest', userAgent: signingUserAgent };
  const results = [await sign(input), await sign(input)];
  console.log(JSON.stringify({ offline: true, sent: false, scriptVersion: signingSdkVersion,
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
