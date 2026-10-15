import { useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { Dialog, ItemImage } from './components';
import { ItemPicker } from './ItemPicker';
import { contractEconomy, contractOutcomes, floatWear, rarityLadder } from './tradeUpMath';
import type { ContractInput, Outcome } from './tradeUpMath';
import { currencies, emptyQuery } from './types';
import type { Item, SteamQuote } from './types';
import { numericPrice } from './sharing';

export default function TradeUp({ currency, seed, onClose }: { currency: string; seed?: Item | null; onClose: () => void }) {
  const [slots, setSlots] = useState<(ContractInput | null)[]>(Array(10).fill(null)); const [selected, setSelected] = useState<number | null>(seed ? 0 : null);
  const [pool, setPool] = useState<Item[]>([]); const [poolError, setPoolError] = useState(''); const [stattrak, setStattrak] = useState(false);
  const [formula, setFormula] = useState<'normalized' | 'report'>('normalized'); const [fee, setFee] = useState(13.04);
  const [outcomePrices, setOutcomePrices] = useState<Record<string, number | null>>({}); const [quoteStatus, setQuoteStatus] = useState('');
  const [simulation, setSimulation] = useState(''); const [pricing, setPricing] = useState(false);
  const put = (index: number, item: Item) => { setSlots(s => s.map((slot, n) => n === index ? { item, float: item.minFloat ?? 0, collectionId: item.collections[0]?.id || '', price: null } : slot)); setSelected(null); setSimulation(''); };
  useEffect(() => { if (seed) put(0, seed); }, [seed]);
  const inputs = slots.filter((s): s is ContractInput => s !== null), rarity = inputs[0]?.item.rarity;
  const context = JSON.stringify([...new Set(inputs.map(i => i.collectionId))].sort());
  useEffect(() => {
    let live = true; setPool([]); setPoolError('');
    void (async () => {
      const collections: string[] = JSON.parse(context); if (!collections.length || !rarity) return;
      const query = { ...structuredClone(emptyQuery), categories: ['skins'], collections, rarities: [rarityLadder[rarityLadder.indexOf(rarity) + 1]], limit: 200 };
      let all: Item[] = [], total = 1;
      while (all.length < total) { const r = await api.search({ ...query, offset: all.length }); all = [...all, ...r.items]; total = r.total; if (!r.items.length) break; }
      if (live) setPool(all);
    })().catch(e => { if (live) setPoolError(String(e)); });
    return () => { live = false; };
  }, [context, rarity]);
  const calculation = useMemo(() => { try { return { outcomes: contractOutcomes(inputs, pool, stattrak, formula), error: '' }; } catch (e) { return { outcomes: [] as Outcome[], error: String(e instanceof Error ? e.message : e) }; } }, [slots, pool, stattrak, formula]);
  const outcomes = calculation.outcomes, economy = contractEconomy(inputs, outcomes, outcomePrices, fee);
  const outcomeWears = JSON.stringify(outcomes.map(o => [o.item.id, o.wear]));
  useEffect(() => { setOutcomePrices({}); setSimulation(''); }, [outcomeWears]);
  useEffect(() => { setSlots(s => s.map(i => i ? { ...i, price: null } : null)); setOutcomePrices({}); setPricing(false); setQuoteStatus(''); }, [currency, stattrak]);
  const quoteContext = JSON.stringify([...inputs.map(i => [i.item.id, i.float]), ...outcomes.map(o => [o.item.id, o.float])]);
  useEffect(() => {
    if (!pricing) return;
    let live = true; let timer: ReturnType<typeof setTimeout>;
    const fetchQuotes = async () => {
      const targets = [...inputs.map((i, slot) => ({ item: i.item, wear: floatWear(i.float), slot })), ...outcomes.map(o => ({ item: o.item, wear: o.wear, slot: -1 }))];
      const quotes = await Promise.all(targets.map(async target => {
        const variant = target.item.variants.find(v => v.wear === target.wear && v.special === (stattrak ? 'StatTrak' : 'Normal'));
        const quote: SteamQuote | null = variant ? await api.price(target.item.id, variant.id, currency, false).catch(() => null) : null;
        return { ...target, quote, price: numericPrice(quote?.lowestPrice) };
      }));
      if (!live) return;
      setSlots(s => s.map(i => { if (!i) return null; const q = quotes.find(q => q.slot >= 0 && q.item.id === i.item.id && q.wear === floatWear(i.float)); return q?.price != null ? { ...i, price: q.price } : i; }));
      setOutcomePrices(p => ({ ...p, ...Object.fromEntries(quotes.filter(q => q.slot < 0 && q.price !== null).map(q => [q.item.id, q.price])) }));
      const pending = quotes.filter(q => q.quote?.pending).length;
      setQuoteStatus(pending ? `${pending} exact-wear prices queued on Steam.` : 'Quotes checked. Enter any missing prices manually.');
      if (pending) timer = setTimeout(() => void fetchQuotes(), 4000); else setPricing(false);
    };
    void fetchQuotes().catch(e => { if (live) { setQuoteStatus(String(e)); setPricing(false); } });
    return () => { live = false; clearTimeout(timer); };
  }, [pricing, quoteContext, currency, stattrak]);
  const amend = (index: number, changes: Partial<ContractInput>) => setSlots(s => s.map((slot, n) => slot && n === index ? { ...slot, ...changes } : slot));
  return <Dialog title="Trade-up contract calculator" wide onClose={onClose}><div className="suite-body">
    <div className="suite-controls"><label><input type="checkbox" checked={stattrak} onChange={e => setStattrak(e.target.checked)} />StatTrak contract</label><label>Float math<select value={formula} onChange={e => setFormula(e.target.value as typeof formula)}><option value="normalized">Normalize input float ranges</option><option value="report">Report formula · raw average</option></select></label><label>Sale fee %<input type="number" min="0" max="100" step=".01" value={fee} onChange={e => setFee(Math.max(0, Math.min(100, Number(e.target.value))))} /></label></div>
    <p className="muted small">Ten skins of the same rarity. Each collection receives its input share of the probability. Normalized math accounts for each input’s float limits; “Report formula” reproduces the supplied document. Prices are estimates for the exact wear. This workspace does not execute a contract.</p>
    <div className="contract-slots">{slots.map((slot, index) => <section key={index}><button className="slot-pick" onClick={() => setSelected(index)}>{slot ? <><ItemImage item={slot.item} interactive={false} /><span>{slot.item.name}</span></> : <span>+ Input {index + 1}</span>}</button>{slot && <><label>Float<input type="number" step="any" min={slot.item.minFloat ?? 0} max={slot.item.maxFloat ?? 1} value={Number.isFinite(slot.float) ? slot.float : ''} onChange={e => amend(index, { float: e.target.value === '' ? NaN : Number(e.target.value), price: null })} /></label><label>Price · {currencies[currency]}<input type="number" min="0" step=".01" value={slot.price ?? ''} onChange={e => amend(index, { price: e.target.value === '' ? null : Number(e.target.value) })} /></label><label>Collection<select value={slot.collectionId} onChange={e => amend(index, { collectionId: e.target.value })}>{slot.item.collections.map(c => <option value={c.id} key={c.id}>{c.name}</option>)}</select></label><button className="text-button" onClick={() => setSlots(s => s.map((i, n) => n === index ? null : i))}>Remove</button></>}</section>)}</div>
    {selected !== null && <div className="suite-picker"><h3>Choose input {selected + 1}</h3><button className="text-button" onClick={() => setSelected(null)}>Close picker</button><ItemPicker categories={['skins']} rarities={rarity ? [rarity] : rarityLadder.slice(0, -1)} specials={stattrak ? ['StatTrak'] : []} accept={i => i.minFloat !== null && Boolean(i.collections.length) && rarityLadder.includes(i.rarity) && i.rarity !== 'Covert' && (!rarity || i.rarity === rarity) && (!stattrak || i.stattrak)} onPick={i => put(selected, i)} /></div>}
    <h3>Outcomes · {outcomes.length}</h3>{(poolError || calculation.error) && <p className="notice">{poolError || calculation.error}</p>}
    {outcomes.length > 0 && <><div className="suite-controls"><button className="button" disabled={pricing} onClick={() => setPricing(true)}>Fetch contract prices</button><button className="button" onClick={() => { let total = 0; const counts = new Map<string, number>(); for (let n = 0; n < 1000; n++) { const draw = Math.random(); let cumulative = 0; const hit = outcomes.find(o => { cumulative += o.probability; return draw < cumulative; }) || outcomes.at(-1)!; counts.set(hit.item.id, (counts.get(hit.item.id) || 0) + 1); total += outcomePrices[hit.item.id] ?? 0; } setSimulation(`1,000 simulated contracts: ${[...counts].map(([id, count]) => `${outcomes.find(o => o.item.id === id)!.item.name}: ${count}`).join(' · ')}${economy ? ` · Average gross return: ${currencies[currency]}${(total / 1000).toFixed(2)}` : ''}`); }}>Simulate 1,000</button></div><p className="muted small">{quoteStatus}</p><div className="suite-metrics">{economy ? <><span>Input cost<strong>{currencies[currency]}{economy.cost.toFixed(2)}</strong></span><span>Expected net return<strong>{currencies[currency]}{economy.ev.toFixed(2)}</strong></span><span>Expected ROI<strong>{economy.roi?.toFixed(1) ?? '—'}%</strong></span><span>Break-even chance<strong>{(economy.breakEven * 100).toFixed(1)}%</strong></span></> : <p className="notice">EV requires a price for every input and outcome. Missing quotes are never counted as zero.</p>}</div><div className="outcomes-grid">{outcomes.map(o => <section key={o.item.id}><ItemImage item={o.item} interactive={false} lazy /><strong>{o.item.name}</strong><span>{(o.probability * 100).toFixed(2)}% · {o.wear} · {o.float.toFixed(8)}</span><label>Gross sale price · {currencies[currency]}<input type="number" min="0" step=".01" value={outcomePrices[o.item.id] ?? ''} onChange={e => setOutcomePrices(p => ({ ...p, [o.item.id]: e.target.value === '' ? null : Number(e.target.value) }))} /></label></section>)}</div>{simulation && <p className="notice">{simulation}</p>}</>}
  </div></Dialog>;
}
