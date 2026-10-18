import type {ChildProcessWithoutNullStreams} from 'node:child_process';
import type {SigningInput,SigningResult,DirectRequestSigner} from './signing-profile.ts';
import {validateSignedUrl,validateSigningInput} from './signing-profile.ts';

export function createSignerProcess(start:()=>ChildProcessWithoutNullStreams,timeoutMs=10_000,idleMs=15*60_000) {
  let child:ChildProcessWithoutNullStreams|undefined;
  let closed=false;let sequence=0;let starts=0;let completed=0;let output='';
  let idle:ReturnType<typeof setTimeout>|undefined;
  let pending:{id:number;input:SigningInput;resolve:(value:SigningResult)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}|undefined;
  function retire():void{clearTimeout(idle);const old=child;child=undefined;output='';completed=0;old?.kill();}
  function fail():void{
    const operation=pending;pending=undefined;
    if(operation){clearTimeout(operation.timer);operation.reject(new Error('Lokale ondertekening mislukt.'));}
    retire();
  }
  function ensure():ChildProcessWithoutNullStreams {
    if(child)return child;
    const current=start();starts++;child=current;output='';
    current.on('error',()=>{if(child===current)fail();});
    current.on('close',()=>{if(child===current)fail();});
    current.stdin.on('error',()=>{if(child===current)fail();});
    current.stdout.on('error',()=>{if(child===current)fail();});
    current.stderr.on('error',()=>{if(child===current)fail();});
    current.stderr.resume();
    current.stdout.on('data',(data:Buffer)=>{
      if(child!==current)return;
      output+=data.toString('utf8');
      if(Buffer.byteLength(output)>32768){fail();return;}
      const end=output.indexOf('\n');if(end<0)return;
      const line=output.slice(0,end);output=output.slice(end+1);
      const operation=pending;
      try{
        if(!operation||output.trim())throw new Error();
        const value=JSON.parse(line) as SigningResult&{id:number;error?:string};
        if(value.id!==operation.id||value.error||!Number.isFinite(value.signMs)||value.signMs<0
          ||!Number.isFinite(value.rssMiB)||value.rssMiB<=0)throw new Error();
        validateSignedUrl(operation.input,value.signedUrl);
        pending=undefined;clearTimeout(operation.timer);completed++;
        if(completed>=100||value.rssMiB>128)retire();
        if(child===current){idle=setTimeout(()=>{if(child===current&&!pending)retire();},idleMs);idle.unref();}
        operation.resolve({signedUrl:value.signedUrl,signMs:value.signMs,rssMiB:value.rssMiB});
      }catch{fail();}
    });
    return current;
  }
  const sign:DirectRequestSigner=async input=>{
    validateSigningInput(input);
    if(closed||pending)throw new Error('Ondertekenaar is gesloten of bezig.');
    clearTimeout(idle);
    const id=++sequence;
    const encoded=JSON.stringify({id,input})+'\n';
    if(Buffer.byteLength(encoded)>32768)throw new Error('Ondertekeningsinvoer te groot.');
    return new Promise<SigningResult>((resolve,reject)=>{
      try{
        const current=ensure();
        pending={id,input,resolve,reject,timer:setTimeout(()=>{if(pending?.id===id)fail();},timeoutMs)};
        current.stdin.write(encoded,error=>{if(error&&child===current)fail();});
      }catch{fail();reject(new Error('Lokale ondertekening mislukt.'));}
    });
  };
  sign.close=()=>{closed=true;fail();};
  sign.workerStats=()=>({starts,restarts:Math.max(0,starts-1)});
  return sign;
}
