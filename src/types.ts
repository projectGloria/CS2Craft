export type Palette = { hex: string; lab: number[]; weight: number };
export type Variant = { id: string; wear: string; special: string; marketHashName: string; image: string };
export type Reference = { id: string; name: string };
export type Item = {
  id: string; sourceId: string; name: string; description: string; category: string; image: string;
  weapon: string; rarity: string; rarityColor: string; collections: Reference[]; containers: Reference[];
  wears: string[]; stattrak: boolean; souvenir: boolean; phase: string; effect: string; tournament: string;
  team: string; minFloat: number | null; maxFloat: number | null; paintIndex: string;
  marketHashName: string | null; variants: Variant[]; palette: Palette[]; contents: string[];
  active: boolean; attributes: Record<string, string>;
};
export type SearchQuery = {
  text: string; categories: string[]; weapons: string[]; rarities: string[]; collections: string[];
  wears: string[]; specials: string[]; effects: string[]; tournaments: string[]; teams: string[]; phases: string[];
  factions: string[]; sides: string[]; containerTypes: string[]; years: string[];
  excludeCategories: string[]; excludeWeapons: string[]; excludeWears: string[]; excludeSpecials: string[]; excludeRarities: string[];
  colors: string[]; floatMin: number | null; floatMax: number | null; priceMin: number | null; priceMax: number | null;
  priceSnapshot?: string;
  color: string | null; colorMode: 'dominant' | 'accent'; similarity: number;
  view: 'explore' | 'favorites' | 'list'; listId: number | null; sort: 'relevance' | 'name' | 'price_asc' | 'price_desc'; offset: number; limit: number;
};
export type Facet = { value: string; label: string; count: number };
export type SearchResult = { items: Item[]; total: number; facets: Record<string, Facet[]>; elapsedMs: number };
export type SavedList = { id: number; name: string; count: number };
export type Saves = { favorites: string[]; lists: SavedList[]; memberships: Record<string, number[]> };
export type CatalogStatus = { revision: string; generatedAt: string; lastChecked: string | null; count: number; indexed: number; refreshing: boolean; progress: number; message: string; error: string | null; cacheBytes: number };
export const emptyQuery: SearchQuery = { text: '', categories: [], weapons: [], rarities: [], collections: [], wears: [], specials: [], effects: [], tournaments: [], teams: [], phases: [], factions: [], sides: [], containerTypes: [], years: [], excludeCategories: [], excludeWeapons: [], excludeWears: [], excludeSpecials: [], excludeRarities: [], colors: [], floatMin: null, floatMax: null, priceMin: null, priceMax: null, color: null, colorMode: 'accent', similarity: 55, view: 'explore', listId: null, sort: 'relevance', offset: 0, limit: 80 };
export const categoryLabels: Record<string, string> = { skins: 'Weapon skins', knives: 'Knives', gloves: 'Gloves', stickers: 'Stickers', charms: 'Charms', slabs: 'Sticker slabs', agents: 'Agents', graffiti: 'Graffiti', patches: 'Patches', music: 'Music kits', containers: 'Containers', collections: 'Collections', collectibles: 'Collectibles', keys: 'Keys', tools: 'Tools', other: 'Other' };
export interface SteamQuote {
  marketHashName: string; currency: string; lowestPrice: string | null; medianPrice: string | null; volume: string | null; checkedAt: string | null; pending: boolean; error: string | null;
}
export type OwnedItem = { assetId: string; name: string; quantity: number; item: Item | null; variantId: string | null; details: string[] };
export type InventoryData = { steamId: string; items: OwnedItem[] };
categoryLabels.ct_agents = 'CT Agents'; categoryLabels.t_agents = 'T Agents';
export const currencies: Record<string, string> = { USD: '$', EUR: '€', TRY: '₺', GBP: '£', CAD: 'CA$', AUD: 'A$', CNY: '¥', BRL: 'R$', JPY: '¥', PLN: 'zł' };
