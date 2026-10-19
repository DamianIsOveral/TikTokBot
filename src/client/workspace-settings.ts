export interface WorkspaceSettings {
  mode: 'auto' | 'columns' | 'stacked';
  visible: 'both' | 'chat' | 'review';
  order: 'chat' | 'review';
  stackFirst: 'chat' | 'review';
  activity: 'chat' | 'review' | 'bottom' | 'column';
  split: number;
  chatHeight: number;
  reviewHeight: number;
  activityHeight: number;
  activityWidth: number;
}

export const defaultWorkspace: WorkspaceSettings = {
  mode:'auto',visible:'both',order:'chat',stackFirst:'chat',activity:'review',split:53,
  chatHeight:480,reviewHeight:420,activityHeight:220,activityWidth:280
};

const choices = {mode:['auto','columns','stacked'],visible:['both','chat','review'],order:['chat','review'],
  stackFirst:['chat','review'],activity:['chat','review','bottom','column']} as const;
export const workspaceRanges = {split:[20,80],chatHeight:[240,960],reviewHeight:[240,960],
  activityHeight:[120,480],activityWidth:[220,480]} as const;

export function normalizeWorkspace(input: unknown): WorkspaceSettings {
  const result = {...defaultWorkspace};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return result;
  const value = input as Record<string,unknown>;
  for (const [key,allowed] of Object.entries(choices)) {
    if (typeof value[key] === 'string' && (allowed as readonly string[]).includes(value[key] as string)) {
      Object.assign(result,{[key]:value[key]});
    }
  }
  for (const [key,[minimum,maximum]] of Object.entries(workspaceRanges)) {
    if (typeof value[key] === 'number' && Number.isFinite(value[key])) {
      Object.assign(result,{[key]:Math.round(Math.min(maximum,Math.max(minimum,value[key])))});
    }
  }
  return result;
}

export function workspacePreset(name: string): WorkspaceSettings | undefined {
  if (name === 'balanced') return {...defaultWorkspace};
  if (name === 'chat') return {...defaultWorkspace,split:65,activity:'column'};
  if (name === 'moderation') return {...defaultWorkspace,order:'review',stackFirst:'review',split:40,activity:'bottom'};
  if (name === 'three') return {...defaultWorkspace,mode:'columns',activity:'column',split:50};
  return undefined;
}

export function workspaceFlow(settings: WorkspaceSettings, width: number): 'columns' | 'stacked' | 'single' {
  if (settings.visible !== 'both') return 'single';
  return settings.mode === 'stacked' || width < (settings.mode === 'columns' ? 760 : 960) ? 'stacked' : 'columns';
}
