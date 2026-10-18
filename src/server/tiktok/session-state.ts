import {createHash,randomUUID} from 'node:crypto';
import {mkdir,open,lstat,rename,writeFile,unlink} from 'node:fs/promises';
import {dirname} from 'node:path';
import {constants} from 'node:fs';
import type {DirectCredentials} from './direct-client.ts';
import {allowedSessionCookies,createBotCookies} from './session-cookies.ts';
import type {CookieSnapshot} from './session-cookies.ts';

interface StoredSession {version:1;seedHash:string;updatedAt:number;cookies:CookieSnapshot}
export class SessionStateError extends Error {
  constructor(){super('Kan de lokale botsessie niet veilig lezen of bewaren. Controleer de privéopslag op de server.');}
}
function validate(value:unknown):StoredSession {
  if(!value||typeof value!=='object')throw new SessionStateError();
  const state=value as StoredSession;
  if(state.version!==1||typeof state.seedHash!=='string'||!/^[a-f0-9]{64}$/.test(state.seedHash)
    ||!Number.isSafeInteger(state.updatedAt)||state.updatedAt<0||state.updatedAt>8.64e15
    ||!state.cookies||typeof state.cookies!=='object'||Array.isArray(state.cookies))throw new SessionStateError();
  if(Object.keys(state.cookies).length>allowedSessionCookies.size)throw new SessionStateError();
  for(const [name,entry] of Object.entries(state.cookies)) {
    if(!allowedSessionCookies.has(name))throw new SessionStateError();
    if(entry===null)continue;
    if(!entry||typeof entry!=='object'||Array.isArray(entry)||typeof entry.value!=='string'||!entry.value
      ||entry.value.length>8192||/[;\r\n\x00]/.test(entry.value)
      ||Object.keys(entry).some(key=>!['value','expires'].includes(key))
      ||(entry.expires!==undefined&&(!Number.isSafeInteger(entry.expires)||Math.abs(entry.expires)>8.64e15)))throw new SessionStateError();
  }
  return state;
}
export async function loadSessionState(path:string,credentials:DirectCredentials,now=Date.now) {
  const jar=createBotCookies(credentials,now);
  const seedHash=createHash('sha256').update(JSON.stringify({botUsername:credentials.botUsername.toLowerCase(),sessionId:credentials.sessionId,
    targetIdc:credentials.targetIdc,msToken:credentials.msToken||'',verifyFp:credentials.verifyFp||''})).digest('hex');
  let updatedAt:number|undefined;
  let lastSaved=JSON.stringify(jar.snapshot());
  try {
    const info=await lstat(path);
    if(!info.isFile()||info.isSymbolicLink()||info.size>128*1024
      ||(process.platform!=='win32'&&(info.mode&0o077)!==0))throw new SessionStateError();
    const file=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
    let state:StoredSession;
    try {const stat=await file.stat();if(!stat.isFile()||stat.size>128*1024||stat.ino!==info.ino||stat.dev!==info.dev
      ||(process.platform!=='win32'&&(stat.mode&0o077)!==0))throw new SessionStateError();
      const buffer=Buffer.alloc(128*1024+1);
      const {bytesRead}=await file.read(buffer,0,buffer.length,0);
      if(bytesRead>128*1024)throw new SessionStateError();
      state=validate(JSON.parse(buffer.subarray(0,bytesRead).toString('utf8')));
    }finally{await file.close();}
    if(state.seedHash===seedHash){
      lastSaved=JSON.stringify(state.cookies);
      jar.restore(state.cookies);updatedAt=state.updatedAt;
    }
  }catch(error){
    if(!(error&&typeof error==='object'&&'code' in error&&error.code==='ENOENT'))throw new SessionStateError();
  }
  let pending=Promise.resolve();
  function flush():Promise<void> {
    const operation=pending.then(async()=>{
      const cookies=jar.snapshot();
      const serialized=JSON.stringify(cookies);
      if(serialized===lastSaved)return;
      const temporary=`${path}.${randomUUID()}.tmp`;
      const stamp=now();
      try {
        const contents=JSON.stringify(validate({version:1,seedHash,updatedAt:stamp,cookies}))+'\n';
        if(Buffer.byteLength(contents)>128*1024)throw new SessionStateError();
        await mkdir(dirname(path),{recursive:true,mode:0o700});
        await writeFile(temporary,contents,{mode:0o600,flag:'wx'});
        await rename(temporary,path);
      }catch{await unlink(temporary).catch(()=>{});throw new SessionStateError();}
      lastSaved=serialized;updatedAt=stamp;
    });
    pending=operation.catch(()=>{});
    return operation;
  }
  return {jar,flush,updatedAt:()=>updatedAt};
}
export type SessionState=Awaited<ReturnType<typeof loadSessionState>>;
