import type {TikTokMessage} from './types.ts';
import type {IncomingChat} from '../shared/events.ts';
import {chatIdentity} from './chat-identity.ts';

export function incomingChat(data:TikTokMessage,botUsername:string,botUserId?:string):IncomingChat {
  const user=String(data.user?.uniqueId||data.user?.displayId||data.uniqueId||'onbekend').slice(0,100);
  const identity=chatIdentity(data.user);
  const isBot=Boolean(botUserId&&identity.userId ? botUserId===identity.userId
    : user.replace(/^@/,'').toLowerCase()===botUsername.replace(/^@/,'').toLowerCase());
  return {type:'chat',user,text:String(data.content??data.comment??'').slice(0,2000),...identity,isBot};
}
