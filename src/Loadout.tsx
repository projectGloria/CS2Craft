import { useEffect, useState } from 'react';
import { api } from './api';
import { Dialog, ItemImage } from './components';
import { ItemPicker } from './ItemPicker';
import { currencies } from './types';
import type { Item } from './types';
import { download, numericPrice, parseCode, shareCode } from './sharing';
const common = ['Agent', 'Knife', 'Gloves', 'AWP', 'SSG 08', 'Desert Eagle', 'P250', 'Five-SeveN / Tec-9', 'MP9 / MAC-10', 'UMP-45', 'P90', 'Nova', 'XM1014', 'Negev'];
const slotsFor = (side: 'CT' | 'T') => [...common.slice(0, 3), side === 'CT' ? 'M4A1-S / M4A4' : 'AK-47', side === 'CT' ? 'USP-S / P2000' : 'Glock-18', ...common.slice(3).map(slot => slot === 'Five-SeveN / Tec-9' ? side === 'CT' ? 'Five-SeveN' : 'Tec-9' : slot === 'MP9 / MAC-10' ? side === 'CT' ? 'MP9' : 'MAC-10' : slot)];
type Equipment = Record<string, Item>;
const storageKey = 'cs2-craft-loadouts-v1';
export default function Loadout({ currency, onClose }: { currency: string; onClose: () => void }) {
  const [side, setSide] = useState<'CT' | 'T'>('CT'); const [equipment, setEquipment] = useState<Equipment>({}); const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState<string | null>(null); const [theme, setTheme] = useState<string | null>(null); const [prices, setPrices] = useState<Record<string, number | null>>({}); const [message, setMessage] = useState(''); const [code, setCode] = useState('');
  const configuration = () => Object.fromEntries(Object.entries(equipment).map(([slot, item]) => [slot, item.id]));
  const restore = async (raw: unknown) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length > 50) throw new Error('Invalid loadout configuration.');
    const allowed = ['CT', 'T'].flatMap(s => slotsFor(s as typeof side).map(slot => `${s}:${slot}`));
    const entries = Object.entries(raw); if (entries.some(([slot, id]) => !allowed.includes(slot) || typeof id !== 'string')) throw new Error('Invalid slot or item identifier.');
    const items = await Promise.all(entries.map(async ([slot, id]) => [slot, await api.item(id as string)] as const));
    for (const [key, item] of items) { const [team, slot] = key.split(':'); const category = slot === 'Agent' ? 'agents' : slot === 'Knife' ? 'knives' : slot === 'Gloves' ? 'gloves' : 'skins'; if (item.category !== category || category === 'agents' && item.team !== (team === 'CT' ? 'Counter-Terrorist' : 'Terrorist') || category === 'skins' && !slot.split(' / ').some(w => item.weapon === w)) throw new Error(`Item does not fit ${key}.`); }
    setEquipment(Object.fromEntries(items));
  };
  useEffect(() => { void Promise.resolve().then(() => restore(JSON.parse(localStorage.getItem(storageKey) || '{}'))).catch(e => setMessage(String(e))).finally(() => setReady(true)); }, []);
  useEffect(() => { if (ready) { try { localStorage.setItem(storageKey, JSON.stringify(configuration())); } catch { setMessage('Could not save the loadout locally. Export it to keep a copy.'); } } }, [equipment, ready]);
  useEffect(() => { let live = true; setPrices({}); void Promise.all(Object.values(equipment).map(async item => [item.id, numericPrice((await api.cachedPrice(item.id, currency))?.lowestPrice)] as const)).then(rows => { if (live) setPrices(Object.fromEntries(rows)); }).catch(e => setMessage(String(e))); return () => { live = false; }; }, [equipment, currency]);
  const chosen = Object.entries(equipment).filter(([slot]) => slot.startsWith(side + ':')).map(([, item]) => item), missing = chosen.filter(i => prices[i.id] == null).length;
  const exportGraphic = () => {
    const escape = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
    const rows = slotsFor(side); const height = 130 + Math.ceil(rows.length / 3) * 100;
    const cells = rows.map((slot, n) => { const item = equipment[`${side}:${slot}`], x = 28 + n % 3 * 390, y = 110 + Math.floor(n / 3) * 100; return `<g transform="translate(${x} ${y})"><rect width="368" height="82" rx="8" fill="#20252c" stroke="${item?.rarityColor || '#444'}"/><text x="14" y="24" fill="#c6ab77" font-size="13">${escape(slot)}</text><text x="14" y="47" fill="#eee" font-size="12">${escape(item?.name || 'Empty slot').slice(0, 58)}</text><text x="14" y="67" fill="#aaa" font-size="11">${item ? prices[item.id] == null ? 'Unpriced' : escape(currencies[currency]) + prices[item.id]!.toFixed(2) : ''}</text></g>`; }).join('');
    download(`cs2-loadout-${side}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${height}" viewBox="0 0 1200 ${height}"><rect width="1200" height="${height}" fill="#101419"/><g font-family="Arial, sans-serif"><text x="28" y="45" fill="#e4c98c" font-size="26">${side} Loadout · CS2 Craft</text><text x="28" y="76" fill="#aaa" font-size="14">${missing ? 'Known subtotal' : 'Total value'}: ${escape(currencies[currency])}${chosen.reduce((n, i) => n + (prices[i.id] ?? 0), 0).toFixed(2)} · ${missing} unpriced</text>${cells}</g></svg>`, 'image/svg+xml');
  };
  const slot = selected?.slice(3) || ''; const category = slot === 'Agent' ? [side === 'CT' ? 'ct_agents' : 't_agents'] : slot === 'Knife' ? ['knives'] : slot === 'Gloves' ? ['gloves'] : ['skins'];
  const weapon = category[0] === 'skins' ? slot.split(' / ') : [];
  return <Dialog title="CT & T loadout builder" wide onClose={onClose}><div className="suite-body"><div className="suite-controls"><div className="segmented">{(['CT', 'T'] as const).map(s => <button key={s} className={side === s ? 'active' : ''} onClick={() => { setSide(s); setSelected(null); }}>{s} side</button>)}</div><label><input type="checkbox" checked={theme !== null} onChange={e => setTheme(e.target.checked ? '#d83b46' : null)} />Color theme</label>{theme && <input type="color" aria-label="Loadout color theme" value={theme} onChange={e => setTheme(e.target.value)} />}<button className="button" onClick={exportGraphic}>Export graphic</button><button className="button" onClick={() => download('cs2-loadout.json', JSON.stringify({ version: 1, equipment: configuration() }, null, 2))}>Export JSON</button><button className="button" onClick={() => { void navigator.clipboard.writeText(shareCode('loadout', configuration())).then(() => setMessage('Loadout code copied.')).catch(e => setMessage(String(e))); }}>Copy share code</button></div>
    <div className="loadout-grid">{slotsFor(side).map(slot => { const key = `${side}:${slot}`, item = equipment[key]; return <section key={key}><h3>{slot}</h3><button className="slot-pick" onClick={() => setSelected(key)}>{item ? <><ItemImage item={item} interactive={false} /><span>{item.name}</span></> : '+ Equip item'}</button>{item && <><p className="muted small">{prices[item.id] == null ? 'No cached price' : `${currencies[currency]}${prices[item.id]!.toFixed(2)}`}</p><button className="text-button" onClick={() => setEquipment(e => { const copy = { ...e }; delete copy[key]; return copy; })}>Unequip</button></>}</section>; })}</div>
    {selected && <div className="suite-picker"><h3>Equip {slot} · {side}</h3><button className="text-button" onClick={() => setSelected(null)}>Close picker</button><ItemPicker categories={category} weapons={weapon} color={theme} onPick={i => { setEquipment(e => ({ ...e, [selected]: i })); setSelected(null); }} /></div>}
    <div className="suite-metrics"><span>{missing ? 'Known subtotal' : 'Total equipped value'}<strong>{currencies[currency]}{chosen.reduce((n, i) => n + (prices[i.id] ?? 0), 0).toFixed(2)}</strong></span><span>Unpriced items<strong>{missing}</strong></span></div><label className="code-import">Load a shared configuration<textarea value={code} onChange={e => setCode(e.target.value)} placeholder="CS2CRAFT:loadout:1:…" /><button className="button" onClick={() => { try { void restore(parseCode(code.trim(), 'loadout')).then(() => setMessage('Loadout imported.')).catch(e => setMessage(String(e))); } catch (e) { setMessage(String(e)); } }}>Import code</button></label>{message && <p className="notice">{message}</p>}
  </div></Dialog>;
}
