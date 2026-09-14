import type { Json } from '@/integrations/supabase/types';
/** Convert structured data to the database JSON contract, rejecting unsupported values. */
export function toJson(value: unknown): Json {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value as string | boolean | null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(toJson);
  if (typeof value === 'object' && value) return Object.fromEntries(Object.entries(value).filter(([,entry]) => entry !== undefined).map(([key,entry]) => [key,toJson(entry)]));
  throw new TypeError('Unsupported JSON value');
}
