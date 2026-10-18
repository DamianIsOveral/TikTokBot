import type {IncomingMessage,ServerResponse} from 'node:http';
import type {DashboardUser} from '../../shared/auth.ts';
import type {AppConfig} from '../config.ts';
import type {DirectChat} from '../tiktok/direct-chat.ts';
import type {createLive} from '../live.ts';
import {allowMutation} from './security.ts';
import {readJson} from './json.ts';
import {CommandError} from '../command-validation.ts';
import {DirectTikTokError,directErrorText} from '../tiktok/direct-client.ts';

export function createCredentialRoutes(config:AppConfig,direct:DirectChat|undefined,live:ReturnType<typeof createLive>){
  let nextAttempt=0;
  return async(req:IncomingMessage,res:ServerResponse,user:DashboardUser,authorized:()=>boolean):Promise<boolean>=>{
    if(req.url!=='/api/bot-session')return false;
    res.setHeader('Content-Type','application/json');
    const reply=(status:number,value:unknown)=>{res.writeHead(status).end(JSON.stringify(value));};
    if(user.role!=='admin'){reply(403,{error:'Alleen beheerders mogen botcookies herstellen.'});return true;}
    if(req.method==='GET'){reply(200,{available:Boolean(direct?.canReplaceSession()),botUsername:config.botUsername});return true;}
    if(!allowMutation(req,res))return true;
    try{
      if(!direct?.canReplaceSession())throw new CommandError('Persistente directe botsessie is niet ingesteld.',409);
      const body=await readJson(req) as Record<string,unknown>;
      const keys=['sessionId','targetIdc','msToken','verifyFp'];
      if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!keys.includes(key))
        ||keys.some(key=>typeof body[key]!=='string'||!(body[key] as string)))throw new CommandError('Vul alle vier botcookievelden in.');
      if(!/^[\w.-]{1,256}$/.test(body.sessionId as string)||!/^[\w-]{1,64}$/.test(body.targetIdc as string)
        ||!/^[\w=+/-]{1,1024}$/.test(body.msToken as string)||!/^[\w.-]{1,200}$/.test(body.verifyFp as string))throw new CommandError('Een botcookie heeft een ongeldige vorm.');
      if(!authorized())throw new CommandError('Log opnieuw in.',401);
      if(Date.now()<nextAttempt)throw new CommandError('Wacht één minuut tussen controles van nieuwe botcookies.',429);
      nextAttempt=Date.now()+60_000;
      await live.stop();
      const result=await direct.replaceSession({botUsername:config.botUsername,sessionId:body.sessionId as string,
        targetIdc:body.targetIdc as string,msToken:body.msToken as string,verifyFp:body.verifyFp as string},authorized);
      console.info(JSON.stringify({event:'bot-session-replaced',actor:user.id,at:new Date().toISOString()}));
      reply(200,{capabilities:result});
    }catch(error){reply(error instanceof CommandError?error.status:400,{error:error instanceof CommandError?error.message:directErrorText(error instanceof DirectTikTokError?error:undefined)});}
    return true;
  };
}
