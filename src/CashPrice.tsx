import { useEffect, useState } from 'react';
import { api } from './api';
import { currencies } from './types';
type Quote = Awaited<ReturnType<typeof api.cashPrice>>;
export function CashPrice({ id, variantId, currency }: { id: string; variantId: string | null; currency: string }) {
  const [quote, setQuote] = useState<Quote | null>(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [attempt, setAttempt] = useState(0);
  const cashCurrency = currency === 'JPY' ? 'USD' : currency;
  useEffect(() => {
    setQuote(null); setError(''); setBusy(false);
    if (!attempt) return;
    let live = true; setBusy(true); void api.cashPrice(id, variantId, cashCurrency).then(q => { if (live) setQuote(q); }).catch(e => { if (live) setError(String(e)); }).finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [id, variantId, cashCurrency, attempt]);
  return <section className="detail-section"><h3>Cash marketplace · Skinport · {cashCurrency}</h3>{quote && <><strong className="price-value">{quote.price === null ? 'No listings' : `${currencies[quote.currency]}${quote.price.toFixed(2)}`}</strong><p className="muted small">{quote.quantity} tradable listings · Updated {new Date(quote.checkedAt).toLocaleString()}</p></>}{(error || quote?.error) && <p className="notice">{error || quote?.error}</p>}<button className="text-button" disabled={busy} onClick={() => setAttempt(n => n + 1)}>{busy ? 'Checking cash quote…' : 'Check cash price'}</button><p className="muted small">Cash listing value; Steam prices use wallet funds. Provider quotes are reused for 15 minutes.{currency === 'JPY' ? ' Skinport does not support JPY; cash prices are displayed in USD.' : ''}</p></section>;
}
