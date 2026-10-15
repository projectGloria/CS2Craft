import { useEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { Dialog, ItemImage } from './components';
import { ItemPicker } from './ItemPicker';
import { api } from './api';
import { currencies } from './types';
import type { Item } from './types';
import { download, numericPrice, parseCode, shareCode } from './sharing';
type Placement = { item: Item; x: number; y: number; rotation: number; wear: number; size: number };
export default function CraftStudio({ seed, currency, onClose }: { seed?: Item | null; currency: string; onClose: () => void }) {
  const [skin, setSkin] = useState<Item | null>(seed?.category === 'skins' ? seed : null);
  const [stickers, setStickers] = useState<Placement[]>([]); const [charm, setCharm] = useState<Placement | null>(null);
  const [picker, setPicker] = useState<'skins' | 'stickers' | 'charms' | null>(seed?.category === 'skins' ? null : 'skins');
  const [selected, setSelected] = useState<number | 'charm' | null>(null); const [prices, setPrices] = useState<Record<string, number | null>>({}); const [message, setMessage] = useState('');
  const [code, setCode] = useState(''); const [fetching, setFetching] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null); const skinRef = useRef<HTMLDivElement>(null);
  const placements = [...stickers, ...(charm ? [charm] : [])], items = [...(skin ? [skin] : []), ...placements.map(p => p.item)];
  const priceContext = JSON.stringify(items.map(i => i.id));
  useEffect(() => {
    if (!fetching) return;
    let live = true; let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      const quotes = await api.prices(JSON.parse(priceContext), currency); if (!live) return;
      setPrices(Object.fromEntries(Object.entries(quotes).map(([id, q]) => [id, numericPrice(q.lowestPrice)])));
      if (Object.values(quotes).some(q => q.pending)) timer = setTimeout(() => void read().catch(e => { if (live) { setMessage(String(e)); setFetching(false); } }), 4000);
      else { setFetching(false); setMessage('Steam quotes checked for the default displayed variants.'); }
    };
    void read().catch(e => { if (live) { setMessage(String(e)); setFetching(false); } });
    return () => { live = false; clearTimeout(timer); };
  }, [fetching, priceContext, currency]);
  const restore = async (raw: unknown) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid craft configuration.');
    const data = raw as { skin: unknown; stickers: unknown; charm: unknown };
    if (typeof data.skin !== 'string' || !Array.isArray(data.stickers) || data.stickers.length > 5) throw new Error('Choose a skin and at most five stickers.');
    const base = await api.item(data.skin); if (base.category !== 'skins') throw new Error('The craft requires a weapon skin.');
    const loadPlacement = async (raw: unknown, category: string): Promise<Placement> => {
      if (!raw || typeof raw !== 'object') throw new Error('Invalid placement.');
      const p = raw as Record<string, unknown>;
      if (typeof p.item !== 'string' || ['x', 'y', 'rotation', 'wear', 'size'].some(k => typeof p[k] !== 'number' || !Number.isFinite(p[k])) || Number(p.x) < 0 || Number(p.x) > 100 || Number(p.y) < 0 || Number(p.y) > 100 || Math.abs(Number(p.rotation)) > 180 || Number(p.wear) < 0 || Number(p.wear) > 100 || Number(p.size) < 5 || Number(p.size) > 35) throw new Error('Invalid placement coordinates.');
      const item = await api.item(p.item); if (item.category !== category) throw new Error('Item does not fit this craft slot.');
      return { item, x: Number(p.x), y: Number(p.y), rotation: Number(p.rotation), wear: Number(p.wear), size: Number(p.size) };
    };
    const nextStickers = await Promise.all(data.stickers.map(p => loadPlacement(p, 'stickers'))); const nextCharm = data.charm ? await loadPlacement(data.charm, 'charms') : null;
    setSkin(base); setStickers(nextStickers); setCharm(nextCharm); setSelected(null); setPicker(null); setPrices({}); setMessage('Craft configuration loaded.');
  };
  const active = selected === 'charm' ? charm : selected !== null ? stickers[selected] : null;
  const amend = (changes: Partial<Placement>) => selected === 'charm' ? setCharm(p => p ? { ...p, ...changes } : null) : setStickers(s => s.map((p, n) => n === selected ? { ...p, ...changes } : p));
  const pick = (item: Item) => {
    if (picker === 'skins') setSkin(item);
    else { const p: Placement = { item, x: 50, y: 50, rotation: 0, wear: 0, size: picker === 'charms' ? 13 : 18 };
      if (picker === 'charms') { setCharm(p); setSelected('charm'); } else if (stickers.length < 5) { setStickers(s => [...s, p]); setSelected(stickers.length); }
    }
    setPicker(null);
  };
  const drag = (e: PointerEvent<HTMLButtonElement>, index: number | 'charm') => {
    e.currentTarget.setPointerCapture(e.pointerId); setSelected(index);
  };
  const move = (e: PointerEvent<HTMLButtonElement>, index: number | 'charm') => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId) || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect(); const changes = { x: Math.max(0, Math.min(100, (e.clientX - rect.left) / rect.width * 100)), y: Math.max(0, Math.min(100, (e.clientY - rect.top) / rect.height * 100)) };
    if (index === 'charm') setCharm(p => p ? { ...p, ...changes } : null); else setStickers(s => s.map((p, n) => n === index ? { ...p, ...changes } : p));
  };
  const quote = async () => {
    try { const entries = await Promise.all(items.map(async i => [i.id, numericPrice((await api.cachedPrice(i.id, currency))?.lowestPrice)] as const)); setPrices(Object.fromEntries(entries)); setMessage('Loaded cached Steam prices. Open item details to fetch missing quotes.'); } catch (e) { setMessage(String(e)); }
  };
  const complete = items.length > 0 && items.every(i => prices[i.id] != null), total = items.reduce((n, i) => n + (prices[i.id] ?? 0), 0);
  const configuration = { skin: skin?.id, stickers: stickers.map(p => ({ ...p, item: p.item.id })), charm: charm ? { ...charm, item: charm.item.id } : null };
  const exportImage = async () => {
    try {
      const canvas = document.createElement('canvas'); canvas.width = 1400; canvas.height = 700; const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#14191f'; ctx.fillRect(0, 0, 1400, 700);
      const draw = async (item: Item, x: number, y: number, width: number, height: number, rotation = 0, wear = 0) => {
        const img = new Image(); img.crossOrigin = 'anonymous'; img.src = await api.image(item.id); await img.decode();
        const ratio = Math.min(width / img.naturalWidth, height / img.naturalHeight); ctx.save(); ctx.translate(x, y); ctx.rotate(rotation * Math.PI / 180); ctx.globalAlpha = 1 - wear / 100 * .9; ctx.drawImage(img, -img.naturalWidth * ratio / 2, -img.naturalHeight * ratio / 2, img.naturalWidth * ratio, img.naturalHeight * ratio); ctx.restore();
      };
      if (skin) await draw(skin, 700, 350, 1400, 700);
      for (const p of placements) await draw(p.item, p.x * 14, p.y * 7, p.size * 14, p.size * 14, p.rotation, p.wear);
      ctx.fillStyle = '#c8b78e'; ctx.font = '16px sans-serif'; ctx.fillText('CS2 Craft · 2D placement concept', 20, 680);
      canvas.toBlob(blob => { if (blob) download('cs2-craft.png', blob, 'image/png'); }, 'image/png');
    } catch (e) { setMessage(`Image export failed: ${String(e)}. Use configuration export to retain the craft.`); }
  };
  return <Dialog title="Sticker & charm studio" wide onClose={onClose}><div className="suite-body"><div className="suite-controls"><button className="button" onClick={() => setPicker('skins')}>{skin ? 'Change weapon skin' : 'Choose weapon skin'}</button><button className="button" disabled={!skin || stickers.length >= 5} onClick={() => setPicker('stickers')}>Add sticker · {stickers.length}/5</button><button className="button" disabled={!skin} onClick={() => setPicker('charms')}>{charm ? 'Change charm' : 'Attach charm'}</button><button className="button" disabled={!skin} onClick={() => void exportImage()}>Export PNG</button><button className="button" disabled={!skin} onClick={() => download('cs2-craft.json', JSON.stringify(configuration, null, 2))}>Export configuration</button><button className="button" disabled={!skin} onClick={() => { void navigator.clipboard.writeText(shareCode('craft', configuration)).then(() => setMessage('Craft code copied.')).catch(e => setMessage(String(e))); }}>Copy craft code</button></div>
    <p className="muted small">Drag stickers or the charm on the artwork. Rotation, size, and scraping are concept previews; coordinates and wear do not reproduce CS2’s surface placement or shaders.</p>
    <div className="craft-canvas" ref={canvasRef}>{skin ? <div ref={skinRef} className="canvas-weapon"><ItemImage item={skin} interactive={false} /></div> : <p>Choose a weapon skin to start.</p>}{placements.map((p, n) => { const index = n < stickers.length ? n : 'charm'; return <button key={`${index}:${p.item.id}`} className={`placed-sticker ${selected === index ? 'chosen' : ''}`} style={{ left: `${p.x}%`, top: `${p.y}%`, width: `${p.size}%`, aspectRatio: '1', transform: `translate(-50%,-50%) rotate(${p.rotation}deg)`, opacity: 1 - p.wear / 100 * .9, filter: p.wear > 80 ? 'grayscale(1)' : undefined }} aria-label={`Move ${p.item.name}`} onPointerDown={e => drag(e, index)} onPointerMove={e => move(e, index)} onPointerUp={e => e.currentTarget.releasePointerCapture(e.pointerId)} onKeyDown={e => { const deltas: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }; if (deltas[e.key]) { e.preventDefault(); setSelected(index); const [dx, dy] = deltas[e.key]; const changes = { x: Math.max(0, Math.min(100, p.x + dx)), y: Math.max(0, Math.min(100, p.y + dy)) }; if (index === 'charm') setCharm(c => c ? { ...c, ...changes } : null); else setStickers(s => s.map((c, j) => j === index ? { ...c, ...changes } : c)); } }} onClick={() => setSelected(index)}><ItemImage item={p.item} interactive={false} /></button>; })}</div>
    {active && <div className="suite-controls placement-controls"><strong>{active.item.name}</strong><label>Rotation · {active.rotation}°<input type="range" min="-180" max="180" value={active.rotation} onChange={e => amend({ rotation: Number(e.target.value) })} /></label><label>Size · {active.size}%<input type="range" min="5" max="35" value={active.size} onChange={e => amend({ size: Number(e.target.value) })} /></label>{selected !== 'charm' && <label>Scraping · {active.wear}%<input type="range" min="0" max="100" value={active.wear} onChange={e => amend({ wear: Number(e.target.value) })} /></label>}<button className="text-button" onClick={() => { if (selected === 'charm') setCharm(null); else setStickers(s => s.filter((_, n) => n !== selected)); setSelected(null); }}>Remove</button></div>}
    {picker && <div className="suite-picker"><h3>Choose {picker === 'skins' ? 'a weapon skin' : picker === 'stickers' ? 'a sticker' : 'a charm'}</h3><button className="text-button" onClick={() => setPicker(null)}>Close picker</button><ItemPicker categories={[picker]} onPick={pick} /></div>}
    <div className="suite-metrics"><span>{complete ? 'Total craft budget' : 'Known subtotal'}<strong>{currencies[currency]}{total.toFixed(2)}</strong></span><span>Unpriced items<strong>{items.filter(i => prices[i.id] == null).length}</strong></span><button className="button" onClick={() => void quote()}>Read cached prices</button><button className="button" disabled={fetching || !items.length} onClick={() => setFetching(true)}>{fetching ? 'Fetching quotes…' : 'Fetch craft prices'}</button></div><label className="code-import">Import a shared craft<textarea value={code} onChange={e => setCode(e.target.value)} placeholder="CS2CRAFT:craft:1:…" /><button className="button" onClick={() => { try { void restore(parseCode(code.trim(), 'craft')).catch(e => setMessage(String(e))); } catch (e) { setMessage(String(e)); } }}>Import craft code</button></label>{message && <p className="notice">{message}</p>}
  </div></Dialog>;
}
