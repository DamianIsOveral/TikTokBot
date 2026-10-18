export interface FilterSettings {
  links: boolean;
  spam: boolean;
  swearing: boolean;
  words: string;
}
export type Category = 'Links' | 'Spam' | 'Schelden';
const defaults: FilterSettings = { links: true, spam: true, swearing: true, words: 'sukkel, idioot' };

export function loadSettings(): FilterSettings {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem('fay-settings') || '{}');
    if (!saved || typeof saved !== 'object') return { ...defaults };
    const value = saved as Record<string, unknown>;
    return {
      links: typeof value.links === 'boolean' ? value.links : defaults.links,
      spam: typeof value.spam === 'boolean' ? value.spam : defaults.spam,
      swearing: typeof value.swearing === 'boolean' ? value.swearing : defaults.swearing,
      words: typeof value.words === 'string' ? value.words.slice(0, 4000) : defaults.words
    };
  } catch { return { ...defaults }; }
}

export function saveSettings(settings: FilterSettings): void {
  localStorage.setItem('fay-settings', JSON.stringify(settings));
}

export function classify(text: string, settings: FilterSettings): Category | null {
  if (settings.links && /(https?:\/\/|www\.|klik op deze link)/i.test(text)) return 'Links';
  if (settings.spam && (/(.{4,}?)\1{2,}/i.test(text) || /volg mij.*volg mij/i.test(text))) return 'Spam';
  const words = settings.words.split(',').map(word => word.trim().toLowerCase()).filter(Boolean);
  if (settings.swearing && words.some(word => text.toLowerCase().includes(word))) return 'Schelden';
  return null;
}

export function automaticCategory(message:{text:string;isBot?:boolean},settings:FilterSettings):Category|null {
  return message.isBot===true ? null : classify(message.text,settings);
}
