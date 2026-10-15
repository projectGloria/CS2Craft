import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { Search, X } from 'lucide-react';
import { api } from './api';
import { ItemImage } from './components';
import { categoryLabels, emptyQuery } from './types';
import type { Item, SearchQuery } from './types';
import type { UsageStatistics } from './usage';

function CachedBadge({ item, currency }: { item: Item; currency: string }) {
  const [price, setPrice] = useState<string | null>(null);
  useEffect(() => { let live = true; setPrice(null); void api.cachedPrice(item.id, currency).then(q => { if (live) setPrice(q?.lowestPrice || null); }).catch(() => {}); return () => { live = false; }; }, [item.id, currency]);
  return price ? <span className="suggestion-price">{price}</span> : null;
}
type Row = { key: string; section: string; label: string; detail?: string; item?: Item; select: () => void };
export function SearchDropdown({ text, onText, onCommit, onChoose, onItem, icons, usage, inputRef, currency }: {
  currency: string; text: string; onText: (text: string) => void; onCommit: () => void; onChoose: (query: Partial<SearchQuery>) => void;
  onItem: (item: Item) => void; icons: Record<string, Item>; usage: UsageStatistics; inputRef: RefObject<HTMLInputElement | null>;
}) {
  const [open, setOpen] = useState(false); const [rows, setRows] = useState<Row[]>([]); const [active, setActive] = useState(-1);
  const [error, setError] = useState(''); const generation = useRef(0);
  const choose = (row: Row) => { onCommit(); row.select(); setOpen(false); };
  useEffect(() => {
    if (!open) return;
    const token = ++generation.current; setActive(-1); setError('');
    const timer = setTimeout(() => {
      void (async () => {
        let next: Row[] = [];
        if (!text.trim()) {
          next = Object.values(usage.groups.searches || {}).sort((a, b) => b.lastUsed.localeCompare(a.lastUsed)).slice(0, 5).map(entry => ({ key: `recent:${entry.value}`, section: 'Recent searches', label: entry.label, select: () => onText(entry.label) }));
          const recent = Object.values(usage.groups.items || {}).sort((a, b) => b.lastUsed.localeCompare(a.lastUsed)).slice(0, 5);
          const items = await Promise.all(recent.map(entry => api.item(entry.value).catch(() => null)));
          for (const item of items) if (item) next.push({ key: item.id, section: 'Recently viewed', label: item.name, item, select: () => onItem(item) });
        } else {
          const [result, references] = await Promise.all([
            api.search({ ...structuredClone(emptyQuery), text, limit: 8 }),
            api.search({ ...structuredClone(emptyQuery), text, categories: ['collections', 'containers'], limit: 4 }),
          ]);
          next = result.items.map(item => ({ key: item.id, section: 'Matching items', label: item.name, detail: [item.weapon, item.phase, item.rarity].filter(Boolean).join(' · '), item, select: () => onItem(item) }));
          const normalized = text.toLowerCase().replace(/[^a-z0-9]/g, '');
          for (const [weapon, item] of Object.entries(icons).filter(([name]) => name.toLowerCase().replace(/[^a-z0-9]/g, '').includes(normalized)).slice(0, 5)) {
            const count = result.facets.weapons?.find(f => f.value === weapon)?.count;
            next.push({ key: `weapon:${weapon}`, section: 'Matching weapons', label: weapon, detail: count ? `${count.toLocaleString()} finishes` : 'Weapon filter', item, select: () => onChoose({ text: '', categories: [], weapons: [weapon] }) });
          }
          for (const [category, label] of Object.entries(categoryLabels).filter(([c, label]) => (c + label).toLowerCase().includes(text.toLowerCase()) || text.toLowerCase().includes('agent') && c.endsWith('_agents')).slice(0, 4)) next.push({ key: `cat:${category}`, section: 'Matching categories', label, select: () => onChoose({ text: '', categories: [category] }) });
          for (const item of references.items) next.push({ key: `ref:${item.id}`, section: 'Collections / cases', label: item.name, item, select: () => item.category === 'collections' ? onChoose({ text: '', categories: [], collections: [item.id] }) : onItem(item) });
        }
        if (token === generation.current) setRows(next);
      })().catch(e => { if (token === generation.current) { setRows([]); setError(String(e)); } });
    }, 40);
    return () => { clearTimeout(timer); generation.current++; };
  }, [text, open, icons, usage]);
  useEffect(() => { if (active >= 0) document.getElementById(`search-option-${active}`)?.scrollIntoView({ block: 'nearest' }); }, [active]);
  return <div className="global-search" onBlur={e => { onCommit(); if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false); }}>
    <Search size={18} /><input ref={inputRef} value={text} placeholder="Search items, wear, phases, collections…" aria-label="Search catalog" role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls="search-suggestions" aria-activedescendant={open && active >= 0 ? `search-option-${active}` : undefined} onFocus={() => setOpen(true)} onChange={e => { onText(e.target.value); setOpen(true); }} onKeyDown={e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setOpen(true); setActive(n => rows.length ? (n + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length : -1); }
      if (e.key === 'Enter') { e.preventDefault(); if (open && active >= 0 && rows[active]) choose(rows[active]); else { onCommit(); setOpen(false); } }
    }} />{text ? <button className="icon-button" aria-label="Clear search" onClick={() => { onText(''); inputRef.current?.focus(); }}><X size={15} /></button> : <kbd>Ctrl K</kbd>}
    {open && <div id="search-suggestions" className="search-dropdown" role="listbox" aria-label="Search suggestions">{rows.map((row, index) => <div key={row.key}>{(index === 0 || rows[index - 1].section !== row.section) && <h3>{row.section}</h3>}<button id={`search-option-${index}`} role="option" aria-selected={active === index} className={active === index ? 'active' : ''} onMouseDown={e => e.preventDefault()} onClick={() => choose(row)}>{row.item && <ItemImage item={row.item} interactive={false} lazy className="search-thumbnail" />}<span className="search-rarity" style={{ background: row.item?.rarityColor || '#d9b253' }} /><span>{row.label}{row.detail && <small>{row.detail}</small>}</span>{row.item && <CachedBadge item={row.item} currency={currency} />}</button></div>)}{!rows.length && <p className="muted small">{error || (text ? 'No matching suggestions.' : 'Search for an item or weapon to begin.')}</p>}<p className="muted small">↑ ↓ Navigate · Enter Select · Esc Close · Exclude with -term</p></div>}
  </div>;
}
