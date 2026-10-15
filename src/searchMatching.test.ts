import { describe, expect, it } from 'vitest';
import { deltaE2000, normalize, parseSearch } from './searchMatching';
import { listExport, numericPrice, parseCode, shareCode } from './sharing';
import type { Item } from './types';
describe('query and color regression checks', () => {
  it('preserves conjunctions and compact punctuation', () => { expect(normalize('Dreams & Nightmares')).toBe(normalize('Dreams and Nightmares')); expect(normalize('USP-S')).toBe(normalize('usp s')); });
  it('supports negated fields and quoted phrases', () => { expect(parseSearch('knife -"black pearl" !wear:bs')).toEqual({ positive: ['knife'], negative: ['black pearl', 'wear:bs'] }); });
  it('matches published CIEDE2000 reference pairs symmetrically', () => { const a = [50, 2.6772, -79.7751], b = [50, 0, -82.7485]; expect(deltaE2000(a, b)).toBeCloseTo(2.0425, 4); expect(deltaE2000(b, a)).toBeCloseTo(2.0425, 4); expect(deltaE2000(a, a)).toBe(0); });
  it('roundtrips Unicode share codes and rejects wrong formats', () => { const data = { name: 'İstanbul · 藍', ids: ['skin:7:282:'] }; expect(parseCode(shareCode('list', data), 'list')).toEqual(data); expect(() => parseCode(shareCode('list', data), 'loadout')).toThrow(); });
  it('parses localized quotes and prevents spreadsheet formulas in CSV', () => { expect(numericPrice('1.234,56€')).toBe(1234.56); expect(numericPrice('Unavailable')).toBeNull(); const csv = listExport('x', [{ id: 'id', name: '=1+1', weapon: '', rarity: '' } as Item], 'csv'); expect(csv).toContain('"\'=1+1"'); });
});
