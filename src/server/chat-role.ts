import type {TikTokMessage} from './types.ts';
export function isChatModerator(data:TikTokMessage):boolean {
  return data.userIdentity?.isModeratorOfAnchor===true||data.user?.userAttr?.isAdmin===true
    ||Boolean(Array.isArray(data.user?.badgeList)&&data.user.badgeList.slice(0,50).some(badge=>badge?.sceneType===1));
}
