import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const files = execFileSync('git', ['ls-files', '--cached', '-z'], {
  encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, windowsHide: true
}).split('\0').filter(Boolean);
const privatePaths = files.filter(path => {
  const parts = path.replaceAll('\\', '/').toLowerCase().split('/');
  const name = parts.at(-1)!;
  return parts.some(part => ['.dev_docs', '.local-archive', 'data', 'secrets'].includes(part))
    || (name !== '.env.example' && (name === '.env' || name.startsWith('.env.') || name.endsWith('.env')))
    || /\.(har|log|pem|key)$/i.test(name);
});
if (privatePaths.length) {
  throw new Error(`Privébestanden staan in Git: ${privatePaths.join(', ')}`);
}
const emptyKeys = new Set(['EULER_API_KEY', 'TIKTOK_SESSION_ID', 'TIKTOK_MS_TOKEN', 'TIKTOK_VERIFY_FP',
  'TIKTOK_TARGET_IDC', 'WHITELIST_AUTHENTICATED_SESSION_ID_HOST', 'DISCORD_CLIENT_ID',
  'DISCORD_CLIENT_SECRET', 'DISCORD_ADMIN_IDS']);
for (const path of files.filter(path => path.replaceAll('\\', '/').split('/').at(-1) === '.env.example')) {
  const example = readFileSync(path, 'utf8');
  for (const match of example.matchAll(/^\s*(?:export\s+)?([A-Za-z_][\w]*)\s*=([^\r\n]*)/gm)) {
    const key = match[1]!;
    if ((emptyKeys.has(key) || /(?:SECRET|TOKEN|API_KEY|PRIVATE_KEY|PASSWORD|SESSION_ID)(?:_FILE)?$/.test(key))
      && !/^(?:''|"")?\s*(?:#.*)?$/.test(match[2]!.trim())) {
      throw new Error(`Voorbeeldcredential moet leeg blijven: ${path}, sleutel ${key}`);
    }
  }
}
console.log('Git bevat geen verboden lokale bestanden; voorbeeldcredentials zijn leeg.');
