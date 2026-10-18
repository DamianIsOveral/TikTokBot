import type {IncomingMessage,ServerResponse} from 'node:http';
import type {createLive} from '../live.ts';
import type {ChatAccess} from '../chat-access.ts';
import type {DirectChat} from '../tiktok/direct-chat.ts';
import type {Diagnostics,Readiness} from '../../shared/diagnostics.ts';
import type {CommandStatus} from '../../shared/command-status.ts';

export function routeDiagnostics(req:IncomingMessage,res:ServerResponse,live:ReturnType<typeof createLive>,capabilities:ChatAccess,
  botEnabled:boolean,direct?:DirectChat):boolean {
  if(!['/api/diagnostics','/api/readiness','/api/command-status'].includes(req.url||''))return false;
  if(req.method!=='GET'){res.writeHead(405,{Allow:'GET'}).end();return true;}
  const {commands,...status}=live.diagnostics();
  const access=capabilities.snapshot();
  const readiness:Readiness={receive:status.connected,send:status.connected&&botEnabled&&access.chat,botEnabled,
    ...(access.session?{session:access.session}:{})};
  if(req.url==='/api/command-status') {
    const snapshot=live.commandStatus();
    const value:CommandStatus={...snapshot,state:!botEnabled?'disabled':!status.connected?'disconnected'
      :!access.chat?'session-unavailable':snapshot.busy?'responding'
      :snapshot.nextReadyAt!>snapshot.serverNow?'cooldown':'ready'};
    res.setHeader('Content-Type','application/json');
    res.setHeader('Cache-Control','no-store');
    res.end(JSON.stringify(value));return true;
  }
  const diagnostics:Diagnostics={uptimeSeconds:Math.floor(process.uptime()),rssMiB:Math.round(process.memoryUsage().rss/1048576),
    readiness,live:status,commands,signer:direct?.diagnostics()||null};
  res.setHeader('Content-Type','application/json');
  res.end(JSON.stringify(req.url==='/api/readiness'?readiness:diagnostics));return true;
}
