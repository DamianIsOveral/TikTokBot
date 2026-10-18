import {readFileSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {StringDecoder} from 'node:string_decoder';
import {signingAssets,signingAssetPaths,signingDirectory,validateSignedUrl,validateSigningInput} from './signing-profile.ts';
import {importUpstreamSigner,signWithUpstream} from './upstream-signer.ts';
import {signPostWithUpstream} from './upstream-post-signer.ts';
import type {SigningInput} from './signing-profile.ts';

try{
  const sources=signingAssets.map((asset,index)=>{
    const path=signingAssetPaths[index];if(statSync(path).size>1048576)throw new Error();
    const source=readFileSync(path);
    if(!source.length||createHash('sha256').update(source).digest('hex')!==asset.sha256)throw new Error();
    return source.toString('utf8');
  });
  globalThis.fetch=async()=>{throw new Error('Netwerk niet beschikbaar.');};
  let upstream:Awaited<ReturnType<typeof importUpstreamSigner>>|undefined;
  async function run(input:SigningInput,id?:number):Promise<void>{
    validateSigningInput(input);
    const start=performance.now();
    const signedUrl=input.method==='POST'?signPostWithUpstream(sources[0],sources[1],input)
      :await signWithUpstream(upstream ||= await importUpstreamSigner(new URL('upstream/src/',signingDirectory)),sources[1],input);
    validateSignedUrl(input,signedUrl);
    process.stdout.write(JSON.stringify({...id?{id}:{},signedUrl,signMs:performance.now()-start,rssMiB:process.memoryUsage().rss/1048576})+'\n');
  }
  let text='';
  const decoder=new StringDecoder('utf8');
  for await(const chunk of process.stdin){
    text+=decoder.write(chunk);
    if(Buffer.byteLength(text)>32768)throw new Error();
    let end:number;
    while((end=text.indexOf('\n'))>=0){
      const frame=JSON.parse(text.slice(0,end)) as {id:number;input:SigningInput};text=text.slice(end+1);
      if(!Number.isSafeInteger(frame.id)||frame.id<=0)throw new Error();
      await run(frame.input,frame.id);
    }
  }
  if(text.trim())await run(JSON.parse(text) as SigningInput);
}catch{process.exitCode=1;process.stdin.destroy();}
