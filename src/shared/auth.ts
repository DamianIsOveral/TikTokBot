export type AccessRole = 'admin' | 'head-moderator' | 'member';
export interface AccessEntry { id: string; role: AccessRole; comment?: string }
export interface AccessDocument { revision: number; users: AccessEntry[] }
export interface AccessSettings extends AccessDocument { protectedIds: string[] }
export interface DashboardUser { id: string; name: string; role: AccessRole }
export interface LoginStatus { authenticated: boolean; configured: boolean; user?: DashboardUser }
