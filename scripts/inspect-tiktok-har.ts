import { stat, readFile } from 'node:fs/promises';
import { inspectTikTokHar } from '../src/server/tiktok/request-shape.ts';

const args = process.argv.slice(2);
if (args.length !== 1 || !args[0].toLowerCase().endsWith('.har')) {
  console.error('Gebruik inspect-tiktok-har.ts <lokaal-bestand.har>. Alleen veldnamen worden getoond.');
  process.exitCode = 1;
} else {
  try {
    const info = await stat(args[0]);
    if (!info.isFile() || info.size > 20_000_000) throw new Error();
    const shapes = inspectTikTokHar(JSON.parse(await readFile(args[0], 'utf8')));
    console.log(JSON.stringify({ chatRequests: shapes }, null, 2));
    if (!shapes.length) {
      console.error('Geen TikTok-chatverzendverzoek gevonden.');
      process.exitCode = 1;
    }
  } catch {
    console.error('HAR kon niet veilig worden gelezen. Gebruik een geldig lokaal HAR-bestand van maximaal 20 MB.');
    process.exitCode = 1;
  }
}
