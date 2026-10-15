import { afterEach, describe, expect, it, vi } from 'vitest';
import { browsingStorageKey, cleanQuery, navigateBrowsing, readBrowsingProfile, resetBrowsingFilters, updateBrowsing } from './browsing';
import type { BrowsingProfile } from './browsing';
import { emptyQuery } from './types';

const initial = (): BrowsingProfile => ({ current: { ...structuredClone(emptyQuery), categories: ['skins'] }, contexts: {} });
afterEach(() => vi.unstubAllGlobals());
describe('remembered browsing choices', () => {
  it('keeps price sorting and global color choices across categories and library navigation', () => {
    let profile = updateBrowsing(initial(), { sort: 'price_asc', text: 'red', color: '#cc3344', colorMode: 'dominant', similarity: 23 });
    for (const target of [{ view: 'explore' as const, categories: ['stickers'], listId: null }, { view: 'favorites' as const, categories: [], listId: null }, { view: 'list' as const, categories: [], listId: 7 }]) {
      profile = navigateBrowsing(profile, target);
      expect(profile.current).toMatchObject({ ...target, sort: 'price_asc', text: 'red', color: '#cc3344', colorMode: 'dominant', similarity: 23 });
    }
    profile = updateBrowsing(profile, { color: '#112233' });
    expect(profile.current.sort).toBe('price_asc');
  });
  it('restores category-specific filters without carrying them into a different item type', () => {
    let profile = updateBrowsing(initial(), { weapons: ['AWP'], wears: ['Factory New'], sort: 'price_desc' });
    profile = navigateBrowsing(profile, { view: 'explore', categories: ['stickers'], listId: null });
    expect(profile.current.weapons).toEqual([]);
    profile = updateBrowsing(profile, { teams: ['Team sample'], effects: ['Holo'] });
    profile = navigateBrowsing(profile, { view: 'explore', categories: ['skins'], listId: null });
    expect(profile.current.weapons).toEqual(['AWP']);
    expect(profile.current.wears).toEqual(['Factory New']);
    expect(profile.current.teams).toEqual([]);
    profile = navigateBrowsing(profile, { view: 'explore', categories: ['stickers'], listId: null });
    expect(profile.current.teams).toEqual(['Team sample']);
    expect(profile.current.effects).toEqual(['Holo']);
    expect(profile.current.sort).toBe('price_desc');
  });
  it('clears filters only when requested and retains sort and color matching preferences', () => {
    const profile = resetBrowsingFilters(updateBrowsing(initial(), { sort: 'price_asc', weapons: ['AWP'], color: '#112233', colorMode: 'dominant', similarity: 12 }));
    expect(profile.current).toMatchObject({ categories: ['skins'], sort: 'price_asc', weapons: [], color: null, colorMode: 'dominant', similarity: 12 });
  });
  it('restores saved contexts while resetting pagination and sanitizing invalid values', () => {
    const saved = updateBrowsing(initial(), { weapons: ['AWP'], sort: 'price_asc' });
    vi.stubGlobal('localStorage', { getItem: vi.fn(() => JSON.stringify(saved)) });
    expect(readBrowsingProfile()).toEqual(saved);
    expect(localStorage.getItem).toHaveBeenCalledWith(browsingStorageKey);
    expect(cleanQuery({ sort: 'invalid', weapons: ['AWP', 'AWP', null], color: 'invalid', similarity: 999, offset: 400, limit: 999 })).toMatchObject({ weapons: ['AWP'], sort: 'relevance', color: null, similarity: 100, offset: 0, limit: 80 });
  });
});
