export interface BrandingMetadata { revision: number; hasIcon: boolean }
export interface BrandingUpdate { revision: number; icon: string | null }

export const maximumIconBytes = 512 * 1024;
export const maximumBrandingBodyBytes = 704 * 1024;

export function validBrandingMetadata(value: unknown): value is BrandingMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  return Number.isSafeInteger(data.revision) && Number(data.revision) >= 0 && typeof data.hasIcon === 'boolean';
}
