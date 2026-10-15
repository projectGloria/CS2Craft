import type { Facet } from './types';
export const usageStorageKey = 'cs2-craft-usage';
export type UsageEntry = { value: string; label: string; count: number; selections: number; searches: number; lastUsed: string };
export type UsageStatistics = { startedAt: string; groups: Record<string, Record<string, UsageEntry>> };
export const newStatistics = (): UsageStatistics => ({ startedAt: new Date().toISOString(), groups: {} });
export function readUsageStatistics(): UsageStatistics {
  const result = newStatistics();
  try {
    const raw = JSON.parse(localStorage.getItem(usageStorageKey) || 'null');
    if (!raw || typeof raw !== 'object') return result;
    if (typeof raw.startedAt === 'string' && Number.isFinite(Date.parse(raw.startedAt))) result.startedAt = raw.startedAt;
    if (!raw.groups || typeof raw.groups !== 'object' || Array.isArray(raw.groups)) return result;
    for (const [group, entries] of Object.entries(raw.groups)) {
      if (!entries || typeof entries !== 'object' || Array.isArray(entries)) continue;
      const valid: [string, UsageEntry][] = [];
      for (const [key, entry] of Object.entries(entries)) {
        if (!entry || typeof entry !== 'object') continue;
        const e = entry as UsageEntry;
        if (typeof e.value !== 'string' || typeof e.label !== 'string' || !Number.isSafeInteger(e.count) || e.count <= 0 || typeof e.lastUsed !== 'string' || !Number.isFinite(Date.parse(e.lastUsed))) continue;
        valid.push([key, { value: e.value, label: e.label, count: e.count, selections: Number.isSafeInteger(e.selections) && e.selections >= 0 ? e.selections : 0, searches: Number.isSafeInteger(e.searches) && e.searches >= 0 ? e.searches : 0, lastUsed: e.lastUsed }]);
      }
      result.groups = { ...result.groups, [group]: Object.fromEntries(valid) };
    }
  } catch { /* Invalid local statistics start a new history. */ }
  return result;
}
export function addUsage(stats: UsageStatistics, group: string, value: string, label: string, source: 'selection' | 'search' | 'view' = 'selection', now = new Date().toISOString()): UsageStatistics {
  const key = `value:${value}`;
  const entries = stats.groups[group] || {};
  const previous = entries[key];
  const entry: UsageEntry = { value, label, count: (previous?.count || 0) + 1, selections: (previous?.selections || 0) + Number(source === 'selection'), searches: (previous?.searches || 0) + Number(source === 'search'), lastUsed: now };
  return { ...stats, groups: { ...stats.groups, [group]: { ...entries, [key]: entry } } };
}
export const usageCount = (stats: UsageStatistics, field: string, value: string) => stats.groups[field]?.[`value:${value}`]?.count || 0;
export const topUsage = (stats: UsageStatistics, group: string) => Object.values(stats.groups[group] || {}).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
export function rankFilterOptions(options: Facet[], selected: string[], stats: UsageStatistics, field: string): Facet[] {
  return [...options].sort((a, b) => Number(selected.includes(b.value)) - Number(selected.includes(a.value)) || usageCount(stats, field, b.value) - usageCount(stats, field, a.value) || a.label.localeCompare(b.label));
}
export function weaponsInSearch(text: string, weapons: string[]): string[] {
  const words = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return weapons.filter(weapon => {
    const name = weapon.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!name) return false;
    return words.some((_, start) => {
      let candidate = '';
      for (let end = start; end < words.length && candidate.length < name.length; end++) { candidate += words[end]; if (candidate === name) return true; }
      return false;
    });
  });
}
export function addSearch(stats: UsageStatistics, text: string, weapons: string[]): UsageStatistics {
  const label = text.trim().replace(/\s+/g, ' ').slice(0, 200);
  if (!label) return stats;
  let next = addUsage(stats, 'searches', label.toLowerCase(), label, 'search');
  for (const weapon of weaponsInSearch(label, weapons)) next = addUsage(next, 'weapons', weapon, weapon, 'search');
  return next;
}
