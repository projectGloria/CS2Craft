import type { CatalogStatus, Facet, Item, Saves, SearchQuery, SearchResult } from './types';
import { agentFaction, categoryMatches, containerType, deltaE2000, excludedItem, itemYears, textScore } from './searchMatching';
type Snapshot = { items: Item[]; revision: string; generatedAt: string };
let snapshot: Promise<Snapshot> | null = null;
const catalog = () => snapshot ??= fetch('/__preview/catalog.json').then(r => { if (!r.ok) throw new Error('Prepare the catalog with npm run catalog:prepare first.'); return r.json() as Promise<Snapshot>; });
const saved = (): Saves => JSON.parse(localStorage.getItem('cs2-craft-preview-saves') || '{"favorites":[],"lists":[],"memberships":{}}');
function editDistance(a: string, b: string): number { const row = Array.from({ length: b.length + 1 }, (_, i) => i); for (let i = 1; i <= a.length; i++) { let prior = row[0]; row[0] = i; for (let j = 1; j <= b.length; j++) { const next = row[j]; row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prior + Number(a[i - 1] !== b[j - 1])); prior = next; } } return row[b.length]; }
export function hexLab(hex: string): number[] { const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(x => x > .04045 ? ((x + .055) / 1.055) ** 2.4 : x / 12.92); const xyz = [(c[0] * .4124564 + c[1] * .3575761 + c[2] * .1804375) / .95047, c[0] * .2126729 + c[1] * .7151522 + c[2] * .072175, (c[0] * .0193339 + c[1] * .119192 + c[2] * .9503041) / 1.08883].map(x => x > .008856 ? Math.cbrt(x) : 7.787 * x + 16 / 116); return [116 * xyz[1] - 16, 500 * (xyz[0] - xyz[1]), 200 * (xyz[1] - xyz[2])]; }
export function previewSearch(items: Item[], q: SearchQuery, saves: Saves): SearchResult {
  const start = performance.now(); const facets: Record<string, Map<string, Facet>> = {}; const matches: { item: Item; score: number }[] = [];
  const targets = [q.color, ...(q.colors || [])].filter((c): c is string => Boolean(c)).slice(0, 2).map(c => hexLab(c.length === 4 ? '#' + [...c.slice(1)].map(x => x + x).join('') : c));
  const one = (vs: string[], v: string) => !vs.length || vs.includes(v);
  const add = (key: string, value: string, label = value) => { if (!value) return; const map = facets[key] ??= new Map(); const f = map.get(value) || { value, label, count: 0 }; f.count++; map.set(value, f); };
  for (const i of items) {
    if (q.view === 'favorites' ? !saves.favorites.includes(i.id) : q.view === 'list' ? !saves.memberships[i.id]?.includes(q.listId!) : !i.active) continue;
    const score = textScore(i, q.text, editDistance); if (score === null || excludedItem(i, q)) continue;
    let distance = 0;
    const distances = targets.map(target => Math.min(...i.palette.filter((p, ix) => q.colorMode !== 'dominant' || ix < 2 && p.weight >= .15).map(p => deltaE2000(p.lab, target))));
    if (distances.some(d => d > 6 + q.similarity * .35)) continue; distance = distances.reduce((sum, d) => sum + d, 0);
    add('categories', i.category); if (i.category === 'agents') add('categories', i.team === 'Counter-Terrorist' ? 'ct_agents' : 't_agents');
    if (q.categories.length && !q.categories.some(c => categoryMatches(c, i))) continue;
    add('weapons', i.weapon); add('rarities', i.rarity); i.collections.forEach(r => add('collections', r.id, r.name)); i.wears.forEach(w => add('wears', w)); for (const [k, v] of [['effects', i.effect], ['tournaments', i.tournament], ['teams', ['Counter-Terrorist', 'Terrorist', 'Both Teams'].includes(i.team) ? '' : i.team], ['sides', ['Counter-Terrorist', 'Terrorist', 'Both Teams'].includes(i.team) ? i.team : ''], ['phases', i.phase], ['factions', agentFaction(i)], ['containerTypes', containerType(i)]]) add(k, v);
    itemYears(i).forEach(year => add('years', year));
    if (i.stattrak) add('specials', 'StatTrak'); if (i.souvenir) add('specials', 'Souvenir'); if (i.variants.length) add('specials', 'Normal');
    if (!one(q.weapons, i.weapon) || !one(q.rarities, i.rarity) || q.collections.length && !i.collections.some(r => q.collections.includes(r.id)) || !one(q.effects, i.effect) || !one(q.tournaments, i.tournament) || !one(q.teams, i.team) || !one(q.phases, i.phase)) continue;
    if (!one(q.sides || [], i.team) || !one(q.factions || [], agentFaction(i)) || !one(q.containerTypes || [], containerType(i)) || q.years?.length && !itemYears(i).some(y => q.years.includes(y))) continue;
    if ((q.wears.length || q.specials.length) && !i.variants.some(v => one(q.wears, v.wear) && one(q.specials, v.special))) continue;
    if ((q.floatMin != null || q.floatMax != null) && (i.minFloat === null || i.maxFloat === null || i.maxFloat < (q.floatMin ?? 0) || i.minFloat > (q.floatMax ?? 1))) continue;
    if (q.priceMin != null || q.priceMax != null) continue;
    matches.push({ item: i, score: score * 100 + distance });
  }
  if (q.sort === 'relevance') matches.sort((a, b) => a.score - b.score);
  return { items: matches.slice(q.offset, q.offset + q.limit).map(x => x.item), total: matches.length, facets: Object.fromEntries(Object.entries(facets).map(([k, v]) => [k, [...v.values()].sort((a, b) => a.label.localeCompare(b.label))])), elapsedMs: performance.now() - start };
}
export async function previewCommand<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const data = await catalog(); const saves = saved(); const item = () => { const i = data.items.find(i => i.id === args.id); if (!i) throw new Error('Item not found'); return i; };
  let result: unknown;
  switch (name) {
    case 'prepare_model': { const response = await fetch(`/__preview/model?id=${encodeURIComponent(String(args.id))}`); if (!response.ok) throw new Error(await response.text()); result = await response.json(); break; }
    case 'search_catalog': result = previewSearch(data.items, args.query as SearchQuery, saves); break;
    case 'get_weapon_icons': {
      const selections = args.selections as Record<string, string>; const icons = new Map<string, Item>();
      const rank = (i: Item) => [selections[i.weapon] === i.id ? 0 : 1, i.name.includes(' | ') ? 0 : 1];
      const candidates = data.items.filter(i => i.active && i.weapon && i.image).sort((a, b) => rank(a)[0] - rank(b)[0] || rank(a)[1] - rank(b)[1] || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
      for (const i of candidates) if (!icons.has(i.weapon)) icons.set(i.weapon, i);
      result = [...icons.values()].sort((a, b) => a.weapon.localeCompare(b.weapon)); break;
    }
    case 'get_item': result = item(); break;
    case 'get_saves': result = saves; break;
    case 'import_list': {
      const title = typeof args.name === 'string' ? args.name.trim() : ''; const ids = args.ids as unknown[];
      if (!title || title.length > 80 || !Array.isArray(ids) || ids.length > 10000 || ids.some(id => typeof id !== 'string' || !data.items.some(i => i.id === id))) throw new Error('Invalid list name or unknown item.');
      const listId = Math.max(Date.now(), ...saves.lists.map(l => l.id + 1)); saves.lists.push({ id: listId, name: title, count: new Set(ids).size });
      for (const id of ids as string[]) (saves.memberships[id] ??= []).push(listId);
      localStorage.setItem('cs2-craft-preview-saves', JSON.stringify(saves)); result = saves; break;
    }
    case 'resolve_image': result = `/__preview/image?id=${encodeURIComponent(String(args.id))}${args.variantId ? `&variant=${encodeURIComponent(String(args.variantId))}` : ''}`; break;
    case 'open_market': { const i = item(); const market = args.variantId ? i.variants.find(v => v.id === args.variantId)?.marketHashName : i.marketHashName; if (!market) throw new Error('No market listing'); window.open(`https://steamcommunity.com/market/listings/730/${encodeURIComponent(market)}`, '_blank', 'noopener'); break; }
    case 'get_status': result = { revision: data.revision, generatedAt: data.generatedAt, lastChecked: null, count: data.items.length, indexed: data.items.filter(i => i.palette.length).length, refreshing: false, progress: 100, message: 'Development preview · packaged app uses SQLite', error: null, cacheBytes: 0 } satisfies CatalogStatus; break;
    case 'save_action': {
      const id = String(args.itemId); const listId = Number(args.listId); const title = String(args.name || '').trim();
      if (args.action === 'favorite' && !saves.favorites.includes(id)) saves.favorites.push(id);
      if (args.action === 'unfavorite') saves.favorites = saves.favorites.filter(x => x !== id);
      if (args.action === 'create') saves.lists.push({ id: Date.now(), name: title, count: 0 });
      if (args.action === 'rename') { const l = saves.lists.find(l => l.id === listId); if (l) l.name = title; }
      if (args.action === 'delete') { saves.lists = saves.lists.filter(l => l.id !== listId); for (const key of Object.keys(saves.memberships)) saves.memberships[key] = saves.memberships[key].filter(x => x !== listId); }
      if (args.action === 'add') { const m = saves.memberships[id] ??= []; if (!m.includes(listId)) m.push(listId); }
      if (args.action === 'remove') saves.memberships[id] = (saves.memberships[id] || []).filter(x => x !== listId);
      for (const l of saves.lists) l.count = Object.values(saves.memberships).filter(m => m.includes(l.id)).length;
      localStorage.setItem('cs2-craft-preview-saves', JSON.stringify(saves)); result = saves; break;
    }
    case 'get_price_revision': result = 0; break;
    case 'get_cached_price': result = null; break;
    case 'get_price_history': result = []; break;
    case 'get_prices': throw new Error('Steam prices are available in the Windows app.');
    case 'import_inventory': throw new Error('Public Steam inventory import is available in the Windows app.');
    case 'get_cash_price': throw new Error('Cash marketplace quotes are available in the Windows app.');
    case 'get_price': throw new Error('Steam prices are available in the Windows app.');
    case 'refresh_catalog': throw new Error('Run catalog:prepare to refresh the development snapshot. Desktop refresh is handled by Rust.');
    case 'clear_cache': throw new Error('Image cache controls are available in the Windows app.');
    default: throw new Error(`Unsupported preview command: ${name}`);
  }
  return result as T;
}
