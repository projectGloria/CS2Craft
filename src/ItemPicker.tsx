import { useEffect, useState } from 'react';
import { api } from './api';
import { ItemImage } from './components';
import { emptyQuery } from './types';
import type { Item, SearchQuery } from './types';
export function ItemPicker({ categories, weapons = [], rarities = [], specials = [], color = null, onPick, accept = () => true }: { categories: string[]; weapons?: string[]; rarities?: string[]; specials?: string[]; color?: string | null; onPick: (item: Item) => void; accept?: (item: Item) => boolean }) {
  const [text, setText] = useState(''); const [items, setItems] = useState<Item[]>([]); const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
  const context = JSON.stringify({ categories, weapons, rarities, specials, color });
  useEffect(() => {
    let live = true; setLoading(true); setError(''); setItems([]);
    const timer = setTimeout(() => { const query: SearchQuery = { ...structuredClone(emptyQuery), ...JSON.parse(context), text, limit: 80 };
      void api.search(query).then(r => { if (live) { setItems(r.items); setLoading(false); } }).catch(e => { if (live) { setError(String(e)); setLoading(false); } });
    }, 100);
    return () => { live = false; clearTimeout(timer); };
  }, [context, text]);
  return <section className="item-picker"><input aria-label="Find an item for this slot" placeholder="Find an item…" value={text} onChange={e => setText(e.target.value)} />{error && <p className="notice error">{error}</p>}<div className="picker-grid" aria-busy={loading}>{items.filter(accept).map(i => <button key={i.id} onClick={() => onPick(i)}><ItemImage item={i} interactive={false} lazy /><span>{i.name}</span></button>)}</div>{loading && <p className="muted small">Searching…</p>}{!loading && !items.some(accept) && <p className="muted small">No eligible items. Try another search.</p>}</section>;
}
