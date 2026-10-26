import { safeGetLocalStorage, safeSetLocalStorage } from '@/lib/helpers';
import type { ObjectType } from '@/lib/objects';

/** The places and people this browser opened last, newest first — for the search box. */
export type RecentObject = { type: ObjectType; key: string; label: string; label_bn?: string | null; kind: string };

const KEY = 'wb_recent_objects';
const MAX = 8;

export function recentObjects(): RecentObject[] {
  try {
    const list = JSON.parse(safeGetLocalStorage(KEY) || '[]');
    return Array.isArray(list) ? list.filter((r) => r && r.type && r.key && r.label).slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export function rememberObject(r: RecentObject) {
  const rest = recentObjects().filter((x) => !(x.type === r.type && x.key === r.key));
  safeSetLocalStorage(KEY, JSON.stringify([r, ...rest].slice(0, MAX)));
}
