export interface FilterSettings {
  links: boolean;
  spam: boolean;
  swearing: boolean;
  words: string;
}

export type Category = 'Links' | 'Spam' | 'Schelden';

export interface FilterDocument {
  revision: number;
  settings: FilterSettings;
}

export const defaultFilterSettings: Readonly<FilterSettings> = {
  links: true, spam: true, swearing: true, words: 'sukkel, idioot'
};

export function validFilterSettings(value: unknown): value is FilterSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const settings = value as Record<string, unknown>;
  return Object.keys(settings).length === 4
    && typeof settings.links === 'boolean' && typeof settings.spam === 'boolean'
    && typeof settings.swearing === 'boolean' && typeof settings.words === 'string'
    && settings.words.length <= 4000 && !/[\p{Cc}\p{Cf}\p{Cs}]/u.test(settings.words);
}

export function validFilterDocument(value: unknown): value is FilterDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const document = value as Record<string, unknown>;
  return Object.keys(document).length === 2 && Number.isSafeInteger(document.revision)
    && Number(document.revision) >= 0 && validFilterSettings(document.settings);
}

export function classify(text: string, settings: FilterSettings): Category | null {
  if (settings.links && /(https?:\/\/|www\.|klik op deze link)/i.test(text)) return 'Links';
  if (settings.spam && (/(.{4,}?)\1{2,}/i.test(text) || /volg mij.*volg mij/i.test(text))) return 'Spam';
  const words = settings.words.split(',').map(word => word.trim().toLowerCase()).filter(Boolean);
  if (settings.swearing && words.some(word => text.toLowerCase().includes(word))) return 'Schelden';
  return null;
}

export function automaticCategory(message: { text: string; isBot?: boolean }, settings: FilterSettings): Category | null {
  return message.isBot === true ? null : classify(message.text, settings);
}
