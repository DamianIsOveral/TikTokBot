import type { CommandDefinition } from '../shared/commands.ts';
import type { TikTokMessage } from './types.ts';
import {isChatModerator} from './chat-role.ts';

export function mayTriggerCommand(audience: CommandDefinition['audience'], message: TikTokMessage, channel: string): boolean {
  if(!audience || audience==='everyone')return true;
  const identity=message.userIdentity;
  const user=message.user;
  const handle=user?.uniqueId||user?.displayId;
  if(identity?.isAnchor===true || (typeof handle==='string' && handle.toLowerCase()===channel.toLowerCase()))return true;
  const badges=Array.isArray(user?.badgeList)?user.badgeList.slice(0,50).filter(badge=>badge&&typeof badge==='object'):[];
  const moderator=isChatModerator(message);
  if(moderator)return true;
  if(audience==='moderators')return false;
  const subscriber=identity?.isSubscriberOfAnchor===true || badges.some(badge=>badge.sceneType===4 || badge.sceneType===7);
  if(subscriber)return true;
  if(audience!=='supporters')return false;
  return badges.some(badge=>{
    const urls=[...(Array.isArray(badge.image?.urlList)?badge.image.urlList:[]),
      ...(Array.isArray(badge.combine?.icon?.urlList)?badge.combine.icon.urlList:[])].slice(0,20);
    return urls.some(url=>{
      try {
        const parsed=new URL(url);
        return parsed.protocol==='https:' && (parsed.hostname==='tiktokcdn.com'||parsed.hostname.endsWith('.tiktokcdn.com'))
          && /\/ranklist_top_gifter_[123]\.png(?:~|$)/.test(parsed.pathname);
      }catch{return false;}
    });
  });
}
