export type AuditAction = 'mute' | 'unmute' | 'ban' | 'unban';
export type AuditStatus = 'pending' | 'accepted' | 'rejected' | 'uncertain';
export interface AuditEntry {
  id: string;
  at: string;
  actor: { id: string; name: string };
  target: { id: string; name: string; displayName?: string };
  roomId: string;
  action: AuditAction;
  duration?: number;
  status: AuditStatus;
  reason?: string;
}
export type AuditInput = Omit<AuditEntry, 'id' | 'at' | 'status' | 'reason'>;
export interface AuditStore {
  list(limit?: number): AuditEntry[];
  begin(input: AuditInput): Promise<AuditEntry>;
  finish(id: string, status: Exclude<AuditStatus, 'pending'>, reason?: string): Promise<AuditEntry>;
}
