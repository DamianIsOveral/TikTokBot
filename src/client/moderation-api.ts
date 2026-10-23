export type ModerationOperation='mute'|'unmute'|'ban'|'unban'|'mute-ban'|'access'|'muted-list'|'blocked-list'|'audit';
type Payload=Record<string,unknown>;
export interface ModerationReply {
  value:Payload;
  reference:string;
  operation:ModerationOperation;
  response:Response;
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const writes=new Set<ModerationOperation>(['mute','unmute','ban','unban','mute-ban']);
function contentType(response?:Response):'json'|'html'|'other'|'missing' {
  const type=response?.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  return !type?'missing':type==='application/json'||type.endsWith('+json')?'json':type==='text/html'?'html':'other';
}

function failed(operation:ModerationOperation,reference:string,kind:'network'|'http'|'invalid-response',response?:Response):Error {
  const type=contentType(response);
  void fetch('/api/moderation/errors',{method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),
    headers:{'Content-Type':'application/json','X-Requested-With':'faynominaal'},
    body:JSON.stringify({reference,operation,kind,status:response?.status||0,contentType:type,redirected:response?.redirected===true})}).catch(()=>{});
  const status=response?`HTTP ${response.status}${type==='html'?', HTML-antwoord':''}`:'netwerkfout';
  const message=writes.has(operation)
    ?'De moderatie-uitkomst is niet bevestigd. Controleer het moderatielog of TikTok voordat je de actie herhaalt.'
    :'Moderatiegegevens konden niet worden geladen. Vernieuw de pagina en controleer je dashboardverbinding.';
  return new Error(`${message} (${status}; referentie ${reference})`);
}

export async function requestModeration(path:string,operation:ModerationOperation,input?:Payload):Promise<ModerationReply> {
  let reference:string=crypto.randomUUID();
  let response:Response;
  try{
    response=await fetch(path,{redirect:'error',headers:{Accept:'application/json','X-Request-ID':reference,
      ...(input?{'Content-Type':'application/json','X-Requested-With':'faynominaal'}:{})},
      ...(input?{method:'POST',body:JSON.stringify(input)}:{})});
  }catch{throw failed(operation,reference,'network');}
  const received=response.headers.get('X-Request-ID');
  if(received&&uuid.test(received))reference=received;
  let value:unknown;
  try{
    if(response.redirected||contentType(response)!=='json')throw new Error();
    value=await response.json();
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();
  }catch{throw failed(operation,reference,'invalid-response',response);}
  return {value:value as Payload,response,reference,operation};
}

export function validateModerationReply(reply:ModerationReply,valid:boolean):void {
  if(!reply.response.ok){
    const message=reply.value.error;
    if(typeof message==='string'&&message.length>0&&message.length<=500&&!/[<>\u0000-\u001f]|JSON\.parse|Unexpected token/i.test(message)){
      throw new Error(`${message} (referentie ${reply.reference})`);
    }
    throw failed(reply.operation,reply.reference,'http',reply.response);
  }
  if(!valid)throw failed(reply.operation,reply.reference,'invalid-response',reply.response);
}
