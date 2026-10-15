import { convertFileSrc, invoke, isTauri } from '@tauri-apps/api/core';
import type { CatalogStatus, InventoryData, Item, Saves, SearchQuery, SearchResult, SteamQuote } from './types';
export const native = isTauri();
// Development-only browser review. Packaged builds use the Rust commands exclusively.
async function command<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  if (native) return invoke<T>(name, args);
  if (import.meta.env.DEV) return (await import('./preview')).previewCommand<T>(name, args ?? {});
  throw new Error('Open CS2 Craft using the installed Windows application.');
}
export const api = {
  cashPrice: (id: string, variantId: string | null, currency: string) => command<{ provider: string; currency: string; price: number | null; quantity: number; checkedAt: string; error: string | null }>('get_cash_price', { id, variantId, currency }),
  inventory: (profile: string) => command<InventoryData>('import_inventory', { profile }),
  importList: (name: string, ids: string[]) => command<Saves>('import_list', { name, ids }),
  cachedPrice: (id: string, currency: string, variantId: string | null = null) => command<SteamQuote | null>('get_cached_price', { id, currency, variantId }),
  prices: (ids: string[], currency: string) => command<Record<string, SteamQuote>>('get_prices', { ids, currency }),
  priceHistory: (id: string, variantId: string | null, currency: string) => command<SteamQuote[]>('get_price_history', { id, variantId, currency }),
  model: async (id: string) => { const result = await command<{ path: string; painted: boolean; note: string }>('prepare_model', { id }); return { ...result, url: native ? convertFileSrc(result.path) : result.path }; },
  price: (id: string, variantId: string | null, currency: string, priority: boolean, refresh = false) => command<SteamQuote>('get_price', { id, variantId, currency, priority, refresh }),
  search: (query: SearchQuery, currency = 'USD') => command<SearchResult>('search_catalog', { query, currency }),
  priceRevision: () => command<number>('get_price_revision'),
  weaponIcons: (selections: Record<string, string>) => command<Item[]>('get_weapon_icons', { selections }),
  item: (id: string) => command<Item>('get_item', { id }),
  saves: () => command<Saves>('get_saves'),
  save: (action: string, itemId: string | null = null, listId: number | null = null, name: string | null = null) => command<Saves>('save_action', { action, itemId, listId, name }),
  image: async (id: string, variantId: string | null = null) => { const path = await command<string>('resolve_image', { id, variantId }); return native ? convertFileSrc(path) : path; },
  market: (id: string, variantId: string | null = null) => command<void>('open_market', { id, variantId }),
  status: () => command<CatalogStatus>('get_status'),
  refresh: () => command<void>('refresh_catalog'),
  clearCache: () => command<void>('clear_cache'),
};
