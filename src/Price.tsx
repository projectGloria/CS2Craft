import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api } from './api';
import { visiblePrice } from './priceBatch';
import type { Item, SteamQuote } from './types';

export const preferredVariant = (item: Item) => item.variants.find(v => v.special === 'Normal' && v.wear === 'Factory New') || item.variants.find(v => v.special === 'Normal') || item.variants[0];
export function Price({ item, variantId, currency, compact = false }: { item: Item; variantId?: string | null; currency: string; compact?: boolean }) {
  const variant = variantId === undefined ? preferredVariant(item) : item.variants.find(v => v.id === variantId);
  const name = variant?.marketHashName || (!item.variants.length ? item.marketHashName : null);
  const [quote, setQuote] = useState<SteamQuote | null>(null);
  const container = useRef<HTMLDivElement>(null); const [visible, setVisible] = useState(!compact);
  useEffect(() => {
    if (!compact || !container.current) return;
    const observer = new IntersectionObserver(entries => setVisible(entries.some(e => e.isIntersecting)));
    observer.observe(container.current); return () => observer.disconnect();
  }, [compact, name]);
  const [error, setError] = useState(''); const [attempt, setAttempt] = useState(0);
  const refreshRequested = useRef(false);
  useEffect(() => { setQuote(null); }, [item.id, variant?.id, currency]);
  useEffect(() => {
    setError(''); if (!name || !visible) return;
    let live = true; let timer: ReturnType<typeof setTimeout>;
    const read = async (refresh = false) => {
      try {
        const q = compact && !refresh ? await visiblePrice(item.id, currency) : await api.price(item.id, variant?.id || null, currency, !compact, refresh);
        if (!live) return; setQuote(q);
        timer = setTimeout(() => void read(), q.pending ? 3000 : q.checkedAt ? 60000 : 300000);
      } catch (e) { if (live) setError(String(e)); }
    };
    const refresh = refreshRequested.current; refreshRequested.current = false;
    void read(refresh);
    return () => { live = false; clearTimeout(timer); };
  }, [item.id, variant?.id, name, currency, compact, attempt, visible]);
  if (!name) return null;
  const age = quote?.checkedAt ? Date.now() - new Date(quote.checkedAt).getTime() : 0;
  const stale = age >= 3600000;
  const value = quote?.lowestPrice || (quote?.pending || !quote ? 'Checking…' : quote.checkedAt ? 'No sell listings' : quote.error ? 'Unavailable' : 'Not checked');
  const wear = variant?.wear ? ({ 'Factory New': 'FN', 'Minimal Wear': 'MW', 'Field-Tested': 'FT', 'Well-Worn': 'WW', 'Battle-Scarred': 'BS' } as Record<string, string>)[variant.wear] || variant.wear : '';
  const checked = quote?.checkedAt ? new Date(quote.checkedAt).toLocaleString() : '';
  if (compact) return <div ref={container} className="card-price" title={`Steam Market · ${name} · ${currency}${checked ? ` · Checked ${checked}` : ''}${quote?.error ? ` · ${quote.error}` : ''}`}><span>{wear || 'Steam'}{stale ? ' · cached' : ''}</span><strong>{error ? 'Unavailable' : value}</strong>{!quote?.pending && !quote?.checkedAt && <button className="icon-button" aria-label={`Check Steam price for ${item.name}`} onClick={() => { refreshRequested.current = true; setAttempt(n => n + 1); }}><RefreshCw size={11} /></button>}</div>;
  return <section className="steam-price detail-section"><div className="price-heading"><h3>Steam Community Market</h3><span>{currency}</span></div><strong className="price-value">{error ? 'Price unavailable' : value}</strong><p className="muted small">Lowest sell listing · {variant ? [variant.wear, variant.special].filter(Boolean).join(' · ') : 'This item'}</p><dl>{quote?.medianPrice && <div><dt>24-hour median</dt><dd>{quote.medianPrice}</dd></div>}{quote?.volume && <div><dt>24-hour sales</dt><dd>{quote.volume}</dd></div>}</dl><p className="price-time">{checked ? `${stale ? 'Cached · ' : ''}Checked ${checked}` : quote?.pending ? 'Queued · fetching directly from Steam' : 'No cached quote'}{quote?.pending && checked ? ' · Updating…' : ''}</p>{(error || quote?.error) && <p className="notice">{error || quote?.error}</p>}<button className="text-button" disabled={quote?.pending && !quote.error} onClick={() => { refreshRequested.current = true; setAttempt(n => n + 1); }}><RefreshCw size={12} />Refresh price</button></section>;
}
