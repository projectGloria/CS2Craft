import { describe, expect, it } from 'vitest';
import type { Item } from './types';
import { contractEconomy, contractOutcomes, floatWear } from './tradeUpMath';
import type { ContractInput } from './tradeUpMath';
const item = (id: string, collection: string, rarity = 'Mil-Spec Grade', minFloat = .1, maxFloat = .5): Item => ({ id, sourceId: id, name: id, description: '', category: 'skins', image: '', weapon: 'AK-47', rarity, rarityColor: '', collections: [{ id: collection, name: collection }], containers: [], wears: [], stattrak: false, souvenir: false, phase: '', effect: '', tournament: '', team: '', minFloat, maxFloat, paintIndex: '', marketHashName: null, variants: [], palette: [], contents: [], active: true, attributes: {} });
const inputs = (): ContractInput[] => Array.from({ length: 10 }, (_, n) => ({ item: item(`in${n}`, n === 9 ? 'B' : 'A'), collectionId: n === 9 ? 'B' : 'A', float: .18, price: 1 }));
const pool = [item('outA', 'A', 'Restricted', 0, .8), ...[1, 2, 3].map(n => item(`outB${n}`, 'B', 'Restricted', 0, 1))];
describe('contract predictions', () => {
  it('splits input probability mass within each eligible collection', () => { const results = contractOutcomes(inputs(), pool, false); expect(results[0].probability).toBeCloseTo(.9); expect(results[1].probability).toBeCloseTo(1 / 30); expect(results.reduce((sum, r) => sum + r.probability, 0)).toBeCloseTo(1); });
  it('handles float caps and keeps the document formula distinct', () => { expect(contractOutcomes(inputs(), pool, false)[0].float).toBeCloseTo(.16); expect(contractOutcomes(inputs(), pool, false)[0].wear).toBe('Field-Tested'); expect(contractOutcomes(inputs(), pool, false, 'report')[0].float).toBeCloseTo(.144); });
  it('rejects impossible floats, mixed rarity, and missing outcome pools', () => { const bad = inputs(); bad[0].float = .6; expect(() => contractOutcomes(bad, pool, false)).toThrow(); expect(() => contractOutcomes(inputs(), pool.slice(0, 1), false)).toThrow(); expect(() => contractOutcomes(inputs(), pool, true)).toThrow(); });
  it('does not invent EV from missing prices and subtracts fees', () => { const rows = inputs(), outcomes = contractOutcomes(rows, pool, false); expect(contractEconomy(rows, outcomes, {}, 10)).toBeNull(); const prices = Object.fromEntries(outcomes.map(o => [o.item.id, 20])); expect(contractEconomy(rows, outcomes, prices, 10)?.ev).toBeCloseTo(18); expect(contractEconomy(rows, outcomes, prices, 10)?.roi).toBeCloseTo(80); });
  it('uses exact wear boundaries', () => { expect([.069999, .07, .15, .38, .45].map(floatWear)).toEqual(['Factory New', 'Minimal Wear', 'Field-Tested', 'Well-Worn', 'Battle-Scarred']); });
});
