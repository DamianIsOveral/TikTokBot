export interface SessionCookies {sessionId:string;targetIdc:string;msToken:string;verifyFp:string}
export const sessionpackError='Bestand of exportwachtwoord ongeldig. Kies het bestand en voer het wachtwoord opnieuw in.';
const maxBytes=65_536;
const encoder=new TextEncoder();
const decoder=new TextDecoder('utf-8',{fatal:true});

function exactKeys(value:unknown,keys:string[]):value is Record<string,unknown> {
  return value!==null&&typeof value==='object'&&!Array.isArray(value)
    &&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
}

function base64(value:unknown,size?:number):Uint8Array<ArrayBuffer> {
  if(typeof value!=='string'||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))throw new Error();
  const decoded=atob(value);
  if(btoa(decoded)!==value||(size!==undefined&&decoded.length!==size))throw new Error();
  return Uint8Array.from(decoded,character=>character.charCodeAt(0));
}

function passwordBytes(password:string):Uint8Array<ArrayBuffer> {
  const characters=Array.from(password);
  if(characters.length<12||characters.some(character=>character.length===1&&/[\uD800-\uDFFF]/.test(character)))throw new Error();
  const bytes=encoder.encode(password);
  if(bytes.byteLength>1024){bytes.fill(0);throw new Error();}
  return bytes;
}

function validCookie(value:unknown,invalid:RegExp,max:number):value is string {
  return typeof value==='string'&&value.length>0&&value.length<=max&&!invalid.test(value);
}

export function clearSessionCookies(cookies:SessionCookies|undefined):void {
  if(cookies)for(const key of ['sessionId','targetIdc','msToken','verifyFp'] as const)cookies[key]='';
}

export async function decryptSessionpack(file:Pick<File,'size'|'arrayBuffer'>,password:string):Promise<SessionCookies> {
  const buffers:Uint8Array<ArrayBuffer>[]=[];
  let cookies:SessionCookies|undefined;
  try{
    if(!Number.isSafeInteger(file.size)||file.size<1||file.size>maxBytes)throw new Error();
    const secret=passwordBytes(password);buffers.push(secret);password='';
    const bytes=new Uint8Array(await file.arrayBuffer());buffers.push(bytes);
    if(bytes.byteLength!==file.size||bytes.byteLength>maxBytes)throw new Error();
    const envelope:unknown=JSON.parse(decoder.decode(bytes));
    if(!exactKeys(envelope,['format','version','kdf','cipher','ciphertext'])
      ||envelope.format!=='session-lantern'||envelope.version!==1
      ||!exactKeys(envelope.kdf,['name','iterations','salt'])
      ||envelope.kdf.name!=='PBKDF2-SHA256'||envelope.kdf.iterations!==600_000
      ||!exactKeys(envelope.cipher,['name','iv'])||envelope.cipher.name!=='AES-256-GCM')throw new Error();
    const salt=base64(envelope.kdf.salt,16);buffers.push(salt);
    const iv=base64(envelope.cipher.iv,12);buffers.push(iv);
    const ciphertext=base64(envelope.ciphertext);buffers.push(ciphertext);
    if(ciphertext.byteLength<16)throw new Error();
    const material=await crypto.subtle.importKey('raw',secret,'PBKDF2',false,['deriveKey']);
    secret.fill(0);
    const key=await crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt,iterations:600_000},material,
      {name:'AES-GCM',length:256},false,['decrypt']);
    const plaintext=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv,
      additionalData:encoder.encode('session-lantern:v1'),tagLength:128},key,ciphertext));buffers.push(plaintext);
    const payload:unknown=JSON.parse(decoder.decode(plaintext));
    if(!exactKeys(payload,['service','exportedAt','cookies'])||payload.service!=='tiktok'
      ||!Number.isSafeInteger(payload.exportedAt)||(payload.exportedAt as number)<=0
      ||!exactKeys(payload.cookies,['sessionId','targetIdc','msToken','verifyFp']))throw new Error();
    const value=payload.cookies;
    if(!validCookie(value.sessionId,/[^\w.-]/,256)||!validCookie(value.targetIdc,/[^\w-]/,64)
      ||!validCookie(value.msToken,/[^\w=+/-]/,1024)||!validCookie(value.verifyFp,/[^\w.-]/,200))throw new Error();
    cookies={sessionId:value.sessionId,targetIdc:value.targetIdc,msToken:value.msToken,verifyFp:value.verifyFp};
    return cookies;
  }catch{
    clearSessionCookies(cookies);
    throw new Error(sessionpackError);
  }finally{
    password='';
    for(const buffer of buffers)buffer.fill(0);
  }
}
