import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

async function checkFolder(folder: string): Promise<void> {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) { await checkFolder(path); continue; }
    const text = await readFile(path, 'utf8');
    if (text.split('\n').length > 700) throw new Error(`${path} overschrijdt 700 regels.`);
    if (/\.(m?js)$/.test(entry.name)) {
      const result = spawnSync(process.execPath, ['--check', path], { stdio: 'inherit' });
      if (result.status !== 0) process.exit(1);
    }
  }
}
for (const folder of ['src', 'public', 'scripts', 'test']) await checkFolder(folder);
console.log('Syntax en bestandslengte gecontroleerd.');
