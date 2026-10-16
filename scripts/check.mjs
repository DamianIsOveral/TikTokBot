import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

for (const folder of ['src', 'public', 'scripts', 'test']) {
  for (const name of await readdir(folder)) {
    const path = `${folder}/${name}`;
    const text = await readFile(path, 'utf8');
    if (text.split('\n').length > 700) throw new Error(`${path} overschrijdt 700 regels.`);
    if (/\.(m?js)$/.test(name)) {
      const result = spawnSync(process.execPath, ['--check', path], { stdio: 'inherit' });
      if (result.status !== 0) process.exit(1);
    }
  }
}
console.log('Syntax en bestandslengte gecontroleerd.');
