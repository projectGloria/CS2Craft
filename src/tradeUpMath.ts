import type { Item } from './types';
export const rarityLadder = ['Consumer Grade', 'Industrial Grade', 'Mil-Spec Grade', 'Restricted', 'Classified', 'Covert'];
export type ContractInput = { item: Item; float: number; collectionId: string; price: number | null };
export type Outcome = { item: Item; probability: number; float: number; wear: string };
export function floatWear(value: number) { return value < .07 ? 'Factory New' : value < .15 ? 'Minimal Wear' : value < .38 ? 'Field-Tested' : value < .45 ? 'Well-Worn' : 'Battle-Scarred'; }
export function contractOutcomes(inputs: ContractInput[], pool: Item[], stattrak: boolean, formula: 'normalized' | 'report' = 'normalized'): Outcome[] {
  if (inputs.length !== 10) throw new Error('Select exactly 10 inputs.');
  const rarity = inputs[0].item.rarity; const tier = rarityLadder.indexOf(rarity);
  if (tier < 0 || tier >= rarityLadder.length - 1) throw new Error('This calculator supports Consumer through Classified inputs.');
  if (inputs.some(({ item, float, collectionId }) => item.category !== 'skins' || item.rarity !== rarity || !item.collections.some(c => c.id === collectionId) || item.minFloat === null || item.maxFloat === null || !Number.isFinite(float) || float < item.minFloat || float > item.maxFloat || stattrak && !item.stattrak)) throw new Error('Inputs must share a rarity, have valid floats, and support the selected contract.');
  const mass = new Map<string, number>(); for (const i of inputs) mass.set(i.collectionId, (mass.get(i.collectionId) || 0) + .1);
  const avg = inputs.reduce((sum, i) => sum + (formula === 'report' ? i.float : i.item.maxFloat === i.item.minFloat ? 0 : (i.float - i.item.minFloat!) / (i.item.maxFloat! - i.item.minFloat!)), 0) / 10;
  const results = new Map<string, Outcome>();
  for (const [id, probability] of mass) {
    const candidates = pool.filter(i => i.active && i.category === 'skins' && i.rarity === rarityLadder[tier + 1] && i.collections.some(c => c.id === id) && i.minFloat !== null && i.maxFloat !== null && (!stattrak || i.stattrak));
    if (!candidates.length) throw new Error('An input collection has no eligible next-tier outcomes. Choose another input.');
    for (const item of candidates) {
      const value = item.minFloat! + (item.maxFloat! - item.minFloat!) * avg;
      const existing = results.get(item.id); if (existing) existing.probability += probability / candidates.length;
      else results.set(item.id, { item, probability: probability / candidates.length, float: value, wear: floatWear(value) });
    }
  }
  return [...results.values()];
}
export function contractEconomy(inputs: ContractInput[], outcomes: Outcome[], prices: Record<string, number | null>, feePercent: number) {
  if (inputs.some(i => i.price === null || !Number.isFinite(i.price) || i.price < 0) || outcomes.some(o => prices[o.item.id] == null || !Number.isFinite(prices[o.item.id]) || prices[o.item.id]! < 0) || !Number.isFinite(feePercent) || feePercent < 0 || feePercent > 100) return null;
  const cost = inputs.reduce((sum, i) => sum + i.price!, 0);
  const net = (id: string) => prices[id]! * (1 - feePercent / 100);
  const ev = outcomes.reduce((sum, o) => sum + o.probability * net(o.item.id), 0);
  return { cost, ev, profit: ev - cost, roi: cost ? (ev / cost - 1) * 100 : null, breakEven: outcomes.filter(o => net(o.item.id) >= cost).reduce((sum, o) => sum + o.probability, 0) };
}
