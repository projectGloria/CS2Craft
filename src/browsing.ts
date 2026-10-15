import { emptyQuery } from './types';
import type { SearchQuery } from './types';

export const browsingStorageKey = 'cs2-craft-browsing';
export const filterFields = ['categories', 'weapons', 'rarities', 'collections', 'wears', 'specials', 'effects', 'tournaments', 'teams', 'phases', 'factions', 'sides', 'containerTypes', 'years'] as const;
export const excludeFields = ['excludeCategories', 'excludeWeapons', 'excludeWears', 'excludeSpecials', 'excludeRarities'] as const;
export const exclusionField = { categories: 'excludeCategories', weapons: 'excludeWeapons', wears: 'excludeWears', specials: 'excludeSpecials', rarities: 'excludeRarities' } as const;
export const filterLabels: Record<string, string> = { categories: 'Category', weapons: 'Weapon', rarities: 'Rarity', collections: 'Collection', wears: 'Available wear', specials: 'Special variant', effects: 'Sticker effect', tournaments: 'Tournament', teams: 'Team', phases: 'Finish phase' };
export type BrowsingProfile = { current: SearchQuery; contexts: Record<string, SearchQuery> };
Object.assign(filterLabels, { weapons: 'Weapon / blade / glove style', teams: 'Esports team', factions: 'Agent squad', sides: 'Faction / side', containerTypes: 'Container type', years: 'Year' });
export const weaponClasses: Record<string, string[]> = {
  Rifles: ['AK-47', 'M4A4', 'M4A1-S', 'Galil AR', 'FAMAS', 'AUG', 'SG 553'],
  'Sniper rifles': ['AWP', 'SSG 08', 'SCAR-20', 'G3SG1'],
  SMGs: ['MP9', 'MAC-10', 'MP7', 'MP5-SD', 'P90', 'PP-Bizon', 'UMP-45'],
  Pistols: ['USP-S', 'Glock-18', 'Desert Eagle', 'P250', 'Five-SeveN', 'Tec-9', 'CZ75-Auto', 'Dual Berettas', 'R8 Revolver', 'P2000'],
  'Heavy & shotguns': ['Nova', 'XM1014', 'MAG-7', 'Sawed-Off', 'M249', 'Negev'],
};
export const contextKey = (query: SearchQuery) => query.view === 'list' ? `list:${query.listId}` : `${query.view}:${[...query.categories].sort().join('|')}`;
export function cleanQuery(raw: unknown): SearchQuery {
  const query = structuredClone(emptyQuery);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return query;
  const value = raw as Record<string, unknown>;
  for (const field of [...filterFields, ...excludeFields]) if (Array.isArray(value[field])) query[field] = [...new Set((value[field] as unknown[]).filter((v): v is string => typeof v === 'string' && v.length > 0 && v.length <= 500))];
  for (const team of query.teams.filter(t => ['Counter-Terrorist', 'Terrorist', 'Both Teams'].includes(t))) if (!query.sides.includes(team)) query.sides.push(team);
  query.teams = query.teams.filter(t => !['Counter-Terrorist', 'Terrorist', 'Both Teams'].includes(t));
  if (typeof value.text === 'string') query.text = value.text.slice(0, 200);
  if (typeof value.color === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.color)) query.color = value.color.length === 4 ? '#' + [...value.color.slice(1)].map(c => c + c).join('') : value.color;
  if (Array.isArray(value.colors)) query.colors = value.colors.filter((v): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)).slice(0, query.color ? 1 : 2);
  for (const field of ['floatMin', 'floatMax', 'priceMin', 'priceMax'] as const) if (typeof value[field] === 'number' && Number.isFinite(value[field]) && value[field] >= 0) query[field] = field.startsWith('float') ? Math.min(1, value[field]) : value[field];
  if (value.colorMode === 'dominant' || value.colorMode === 'accent') query.colorMode = value.colorMode;
  if (typeof value.similarity === 'number' && Number.isFinite(value.similarity)) query.similarity = Math.max(0, Math.min(100, value.similarity));
  if (['relevance', 'name', 'price_asc', 'price_desc'].includes(String(value.sort))) query.sort = value.sort as SearchQuery['sort'];
  if (value.view === 'favorites' || value.view === 'list') query.view = value.view;
  if (typeof value.listId === 'number' && Number.isSafeInteger(value.listId) && value.listId > 0) query.listId = value.listId;
  if (query.view === 'list' && !query.listId) query.view = 'explore';
  return query;
}
export function readBrowsingProfile(): BrowsingProfile {
  try {
    const raw = JSON.parse(localStorage.getItem(browsingStorageKey) || 'null');
    if (!raw || typeof raw !== 'object' || !raw.current) throw new Error('No saved browsing preferences');
    const contexts: Record<string, SearchQuery> = {};
    if (raw.contexts && typeof raw.contexts === 'object' && !Array.isArray(raw.contexts)) for (const value of Object.values(raw.contexts)) {
      const query = cleanQuery(value); contexts[contextKey(query)] = query;
    }
    return { current: cleanQuery(raw.current), contexts };
  } catch { return { current: { ...structuredClone(emptyQuery), categories: ['skins'] }, contexts: {} }; }
}
export function updateBrowsing(profile: BrowsingProfile, changes: Partial<SearchQuery>): BrowsingProfile {
  const next = { ...profile.current, ...changes, offset: 0 };
  return { current: next, contexts: { ...profile.contexts, [contextKey(profile.current)]: profile.current, [contextKey(next)]: next } };
}
export function navigateBrowsing(profile: BrowsingProfile, target: Pick<SearchQuery, 'view' | 'categories' | 'listId'>): BrowsingProfile {
  const current = profile.current;
  const key = contextKey({ ...current, ...target });
  const remembered = profile.contexts[key] || emptyQuery;
  const next: SearchQuery = { ...structuredClone(emptyQuery), ...remembered, ...target, text: current.text, color: current.color, colors: current.colors, colorMode: current.colorMode, similarity: current.similarity, sort: current.sort, offset: 0, limit: emptyQuery.limit };
  return { current: next, contexts: { ...profile.contexts, [contextKey(current)]: current, [key]: next } };
}
export function resetBrowsingFilters(profile: BrowsingProfile): BrowsingProfile {
  const { categories, view, listId, sort, colorMode, similarity } = profile.current;
  return updateBrowsing(profile, { ...structuredClone(emptyQuery), categories, view, listId, sort, colorMode, similarity });
}
