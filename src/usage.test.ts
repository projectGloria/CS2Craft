import { afterEach, describe, expect, it, vi } from 'vitest';
import { addSearch, addUsage, newStatistics, rankFilterOptions, readUsageStatistics, topUsage, weaponsInSearch } from './usage';

afterEach(() => vi.unstubAllGlobals());
describe('personal filter priority and activity counts', () => {
  it('puts selected options first, then frequent choices, with alphabetic ties', () => {
    let stats = newStatistics();
    stats = addUsage(stats, 'weapons', 'AWP', 'AWP');
    stats = addSearch(stats, 'AWP redline', ['AWP', 'AK-47']);
    stats = addUsage(stats, 'weapons', 'AK-47', 'AK-47');
    const options = ['AK-47', 'AWP', 'USP-S', 'AUG'].map(value => ({ value, label: value, count: 1 }));
    expect(rankFilterOptions(options, ['USP-S'], stats, 'weapons').map(x => x.value)).toEqual(['USP-S', 'AWP', 'AK-47', 'AUG']);
    expect(rankFilterOptions(options, [], stats, 'weapons').map(x => x.value)).toEqual(['AWP', 'AK-47', 'AUG', 'USP-S']);
    expect(topUsage(stats, 'weapons')[0]).toMatchObject({ value: 'AWP', count: 2, selections: 1, searches: 1 });
    expect(options.map(x => x.value)).toEqual(['AK-47', 'AWP', 'USP-S', 'AUG']);
  });
  it('recognizes weapon names in searches without partial-word false matches', () => {
    expect(weaponsInSearch('stattrak AK47 redline and USP-S', ['AK-47', 'USP-S', 'AWP'])).toEqual(['AK-47', 'USP-S']);
    expect(weaponsInSearch('drawpaint decal', ['AWP'])).toEqual([]);
  });
  it('groups repeated searches, separates views from choices, and ignores empty searches', () => {
    let stats = addSearch(newStatistics(), ' AWP   redline ', ['AWP']);
    stats = addSearch(stats, 'awp redline', ['AWP']);
    stats = addUsage(stats, 'items', 'skin-id', 'AWP | Redline', 'view');
    expect(topUsage(stats, 'searches')).toHaveLength(1);
    expect(topUsage(stats, 'searches')[0].count).toBe(2);
    expect(topUsage(stats, 'items')[0]).toMatchObject({ count: 1, selections: 0, searches: 0 });
    expect(addSearch(stats, '  ', ['AWP'])).toBe(stats);
  });
  it('retains statistics across reloads and rejects invalid saved counts', () => {
    const stats = addUsage(newStatistics(), 'weapons', 'AWP', 'AWP');
    const invalid = { value: 'AK-47', label: 'AK-47', count: -1, lastUsed: 'bad' };
    const raw = { ...stats, groups: { ...stats.groups, invalid: { bad: invalid } } };
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(raw) });
    expect(readUsageStatistics().groups.weapons).toEqual(stats.groups.weapons);
    expect(readUsageStatistics().groups.invalid).toEqual({});
  });
});
