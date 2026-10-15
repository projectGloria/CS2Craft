import type { Item, SearchQuery } from './types';
export const normalize = (s: string) => s.toLowerCase().replaceAll('&', 'and').replace(/[^\p{L}\p{N}]/gu, '');
export const categoryMatches = (category: string, i: Item) => category === 'ct_agents' ? i.category === 'agents' && i.team === 'Counter-Terrorist' : category === 't_agents' ? i.category === 'agents' && i.team === 'Terrorist' : category === 'containers' ? i.category === 'containers' || i.category === 'tools' && containerType(i) === 'Operation passes' : i.category === category;
export const agentFaction = (i: Item) => i.category === 'agents' ? i.name.split(' | ')[1] || '' : '';
export function containerType(i: Item) {
  if (!['containers', 'tools'].includes(i.category)) return '';
  const n = i.name.toLowerCase();
  return n.includes('souvenir') && n.includes('package') ? 'Souvenir packages' : n.includes('autograph') && n.includes('capsule') ? 'Autograph capsules' : n.includes('capsule') ? 'Sticker capsules' : n.includes('case') ? 'Weapon cases' : n.includes('pass') ? 'Operation passes' : 'Other containers';
}
export const itemYears = (i: Item) => [...new Set((i.name + ' ' + i.tournament).match(/\b20\d{2}\b/g) || [])];
const wearAliases: Record<string, string> = { 'Factory New': 'fn', 'Minimal Wear': 'mw', 'Field-Tested': 'ft', 'Well-Worn': 'ww', 'Battle-Scarred': 'bs' };
const fieldCache = new WeakMap<Item, [string, string, number][]>();
export function searchFields(i: Item): [string, string, number][] {
  const existing = fieldCache.get(i); if (existing) return existing;
  const fields: [string, string, number][] = [['name', i.name, 100], ['weapon', i.weapon, 80], ['phase', i.phase, 75], ...i.collections.map(r => ['collection', r.name, 50] as [string, string, number]), ...i.containers.map(r => ['case', r.name, 50] as [string, string, number]), ['rarity', i.rarity, 35], ['cat', i.category, 35], ['team', i.team, 35], ['faction', agentFaction(i), 35], ['effect', i.effect, 35], ['tournament', i.tournament, 50]];
  for (const wear of [...i.wears, ...i.variants.map(v => v.wear)]) fields.push(['wear', wear, 35], ['wear', wearAliases[wear] || '', 35]);
  if (i.stattrak) fields.push(['special', 'stattrak', 35], ['special', 'st', 35]);
  if (i.souvenir) fields.push(['special', 'souvenir', 35]);
  if (i.variants.some(v => v.special === 'Normal')) fields.push(['special', 'normal', 35]);
  if (i.category === 'agents') fields.push(['cat', i.team === 'Counter-Terrorist' ? 'ct_agents' : 't_agents', 35], ['team', i.team === 'Counter-Terrorist' ? 'ct' : 't', 35]);
  const result = fields.filter(([, value]) => value).flatMap(([field, value, weight]) => [[field, normalize(value), weight] as [string, string, number], ...value.replaceAll('&', ' and ').split(/[^\p{L}\p{N}]+/u).filter(Boolean).map(word => [field, normalize(word), weight] as [string, string, number])]);
  fieldCache.set(i, result); return result;
}
export function parseSearch(text: string) {
  const tokens = (text.match(/(?:[^\s"]|"[^"]*")+/g) || []).map(s => s.replaceAll('"', ''));
  return { positive: tokens.filter(s => !/^[-!].+/.test(s)), negative: tokens.filter(s => /^[-!].+/.test(s)).map(s => s.slice(1)) };
}
export function textScore(i: Item, text: string, editDistance: (a: string, b: string) => number): number | null {
  const { positive, negative } = parseSearch(text); const fields = searchFields(i);
  const contains = (value: string, token: string) => token.length <= 2 ? value === token : value.includes(token);
  for (const term of negative) {
    const colon = term.indexOf(':'); let field = colon >= 0 ? term.slice(0, colon) : null;
    field = field === 'category' ? 'cat' : field === 'container' ? 'case' : field === 'variant' ? 'special' : field;
    const token = normalize(colon >= 0 ? term.slice(colon + 1) : term);
    if (token && fields.some(([f, value]) => (!field || field === f) && contains(value, token))) return null;
  }
  const full = normalize(positive.join(' ')); const name = normalize(i.name);
  if (!full || name === full) return 0; if (name.includes(full)) return 1;
  let score = 2;
  for (const token of positive.map(normalize).filter(Boolean)) {
    const weights = fields.filter(([, value]) => contains(value, token)).map(([, , w]) => w);
    if (weights.length) score += 100 - Math.max(...weights);
    else if (token.length >= 4 && i.name.split(/[^\p{L}\p{N}]+/u).some(word => editDistance(token, normalize(word)) <= (token.length >= 8 ? 2 : 1))) score += 90;
    else return null;
  }
  return score;
}
export function excludedItem(i: Item, q: SearchQuery) {
  const fields = searchFields(i);
  return (q.excludeCategories || []).some(c => categoryMatches(c, i)) || (q.excludeWeapons || []).includes(i.weapon) || (q.excludeRarities || []).includes(i.rarity) || (q.excludeWears || []).some(w => fields.some(([f, v]) => f === 'wear' && v === normalize(w))) || (q.excludeSpecials || []).some(s => fields.some(([f, v]) => f === 'special' && v === normalize(s)));
}
export function deltaE2000(a: number[], b: number[]): number {
  const [l1, a1, b1] = a, [l2, a2, b2] = b;
  const rad = Math.PI / 180, cos = (v: number) => Math.cos(v * rad);
  const cbar = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const g = .5 * (1 - Math.sqrt(cbar ** 7 / (cbar ** 7 + 25 ** 7)));
  const ap1 = (1 + g) * a1, ap2 = (1 + g) * a2, c1 = Math.hypot(ap1, b1), c2 = Math.hypot(ap2, b2);
  const hue = (x: number, y: number) => x === 0 && y === 0 ? 0 : (Math.atan2(y, x) / rad + 360) % 360;
  const h1 = hue(ap1, b1), h2 = hue(ap2, b2), dl = l2 - l1, dc = c2 - c1;
  let hd = h2 - h1; if (!c1 || !c2) hd = 0; else if (hd > 180) hd -= 360; else if (hd < -180) hd += 360;
  const dh = 2 * Math.sqrt(c1 * c2) * Math.sin(hd / 2 * rad), lb = (l1 + l2) / 2, cb = (c1 + c2) / 2;
  const hb = !c1 || !c2 ? h1 + h2 : Math.abs(h1 - h2) <= 180 ? (h1 + h2) / 2 : h1 + h2 < 360 ? (h1 + h2 + 360) / 2 : (h1 + h2 - 360) / 2;
  const t = 1 - .17 * cos(hb - 30) + .24 * cos(2 * hb) + .32 * cos(3 * hb + 6) - .20 * cos(4 * hb - 63);
  const sl = 1 + .015 * (lb - 50) ** 2 / Math.sqrt(20 + (lb - 50) ** 2), sc = 1 + .045 * cb, sh = 1 + .015 * cb * t;
  const rt = -2 * Math.sqrt(cb ** 7 / (cb ** 7 + 25 ** 7)) * Math.sin(60 * Math.exp(-(((hb - 275) / 25) ** 2)) * rad);
  return Math.sqrt(Math.max(0, (dl / sl) ** 2 + (dc / sc) ** 2 + (dh / sh) ** 2 + rt * dc / sc * dh / sh));
}
