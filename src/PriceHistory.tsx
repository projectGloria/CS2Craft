import { useEffect, useState } from 'react';
import { api } from './api';
import type { SteamQuote } from './types';
import { numericPrice } from './sharing';
export function PriceHistory({ id, variantId, currency }: { id: string; variantId: string | null; currency: string }) {
  const [points, setPoints] = useState<SteamQuote[]>([]); const [days, setDays] = useState(30); const [error, setError] = useState('');
  useEffect(() => {
    let live = true; setError(''); setPoints([]);
    const read = () => { void api.priceHistory(id, variantId, currency).then(p => { if (live) setPoints(p); }).catch(e => { if (live) setError(String(e)); }); };
    read(); const timer = setInterval(read, 15000); return () => { live = false; clearInterval(timer); };
  }, [id, variantId, currency]);
  const values = points.map(p => ({ time: p.checkedAt ? Date.parse(p.checkedAt) : NaN, price: numericPrice(p.lowestPrice), volume: numericPrice(p.volume?.replace(/[.,]/g, '')) })).filter((p): p is { time: number; price: number; volume: number | null } => p.price !== null && Number.isFinite(p.time) && p.time >= Date.now() - days * 86400000);
  const low = Math.min(...values.map(p => p.price)), high = Math.max(...values.map(p => p.price));
  const minTime = values[0]?.time || 0, maxTime = values.at(-1)?.time || 0;
  const polyline = values.map(p => `${20 + (p.time - minTime) / Math.max(1, maxTime - minTime) * 360},${105 - (p.price - low) / Math.max(.01, high - low) * 80}`).join(' ');
  const mean = values.reduce((sum, p) => sum + p.price, 0) / values.length;
  const deviation = Math.sqrt(values.reduce((sum, p) => sum + (p.price - mean) ** 2, 0) / values.length);
  const latest = values.at(-1), prior = latest && [...values].reverse().find(p => p.time <= latest.time - 86400000);
  return <section className="detail-section"><h3>Recorded price history · {currency}</h3><div className="history-ranges">{[7, 30, 90].map(d => <button key={d} className={days === d ? 'active' : ''} aria-pressed={days === d} onClick={() => setDays(d)}>{d} days</button>)}</div>{values.length >= 2 ? <><svg viewBox="0 0 400 130" role="img" className="history-chart" aria-label={`${days}-day recorded prices, ${low.toFixed(2)} to ${high.toFixed(2)} ${currency}`}><polyline fill="none" stroke="#d9b253" strokeWidth="2" points={polyline} /><text x="20" y="16" fill="#a7b0bb" fontSize="10">{high.toFixed(2)}</text><text x="20" y="122" fill="#a7b0bb" fontSize="10">{low.toFixed(2)}</text><text x="395" y="122" textAnchor="end" fill="#a7b0bb" fontSize="9">{new Date(maxTime).toLocaleDateString()}</text></svg><div className="history-stats"><span>Observed volatility: {mean > 0 ? (deviation / mean * 100).toFixed(1) : '0'}%</span><span>24h sales change: {prior?.volume != null && latest?.volume != null ? latest.volume - prior.volume : 'Not enough history'}</span></div></> : <p className="muted small">{error || 'History starts as quotes are fetched. At least two recorded prices are needed for a trend.'}</p>}</section>;
}
