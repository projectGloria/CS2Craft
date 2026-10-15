import { describe, expect, it } from 'vitest';
import { hexLab, previewSearch } from './preview';
import { emptyQuery } from './types';
import type { Item, Saves } from './types';
const saves: Saves = { favorites: [], lists: [], memberships: {} };
const make = (id: string, name: string, category: string): Item => ({ id, name, category, sourceId: id, description: '', image: '', weapon: '', rarity: '', rarityColor: '', collections: [], containers: [], wears: [], stattrak: false, souvenir: false, phase: '', effect: '', tournament: '', team: '', minFloat: null, maxFloat: null, paintIndex: '', marketHashName: null, variants: [], palette: [], contents: [], active: true, attributes: {} });
describe('development UI adapter parity', () => {
  it('matches punctuation, small typos, and AND/OR filters', () => { const a = make('a', 'AK-47 | Redline', 'skins'); a.weapon = 'AK-47'; const b = make('b', 'Sticker | Redline', 'stickers'); expect(previewSearch([a, b], { ...emptyQuery, text: 'ak47 redlne' }, saves).total).toBe(1); expect(previewSearch([a, b], { ...emptyQuery, categories: ['skins', 'stickers'], weapons: ['AK-47'] }, saves).total).toBe(1); });
  it('keeps small accents distinct from dominant colors', () => { const i = make('a', 'Accent sample', 'skins'); i.palette = [{ hex: '#222222', lab: hexLab('#222222'), weight: .9 }, { hex: '#ff0000', lab: hexLab('#ff0000'), weight: .1 }]; expect(previewSearch([i], { ...emptyQuery, color: '#ff0000', similarity: 0, colorMode: 'accent' }, saves).total).toBe(1); expect(previewSearch([i], { ...emptyQuery, color: '#ff0000', similarity: 0, colorMode: 'dominant' }, saves).total).toBe(0); });
  it('keeps archived favorites visible', () => { const i = make('a', 'Archived', 'skins'); i.active = false; expect(previewSearch([i], emptyQuery, saves).total).toBe(0); expect(previewSearch([i], { ...emptyQuery, view: 'favorites' }, { ...saves, favorites: ['a'] }).total).toBe(1); });
  it('uses the same D65 red reference as native indexing', () => { const lab = hexLab('#ff0000'); expect(lab[0]).toBeCloseTo(53.24, 1); expect(lab[1]).toBeCloseTo(80.09, 1); });
});
