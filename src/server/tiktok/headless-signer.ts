import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {ensureSigningAssets} from './signing-assets.ts';
import {signingAssetPaths} from './signing-profile.ts';
import {createSignerProcess} from './signer-process.ts';

export async function createHeadlessSigner() {
  await ensureSigningAssets();
  const worker=fileURLToPath(new URL('./signing-worker.ts',import.meta.url));
  const readable=[worker,...['signing-profile.ts','upstream-signer.ts','upstream-post-signer.ts','moderation-spec.ts'].map(name=>fileURLToPath(new URL(name,import.meta.url))),...signingAssetPaths];
  return createSignerProcess(()=>spawn(process.execPath,['--permission','--max-old-space-size=64',
    ...readable.map(path=>'--allow-fs-read='+path),worker],{
    windowsHide:true,env:{SystemRoot:process.env.SystemRoot||''},stdio:['pipe','pipe','pipe']
  }));
}
