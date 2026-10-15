import { api } from './api';
import type { SteamQuote } from './types';
type Waiter = { id: string; resolve: (q: SteamQuote) => void; reject: (e: unknown) => void };
const batches = new Map<string, Waiter[]>();
export function visiblePrice(id: string, currency: string): Promise<SteamQuote> {
  return new Promise((resolve, reject) => {
    const waiting = batches.get(currency);
    if (waiting) { waiting.push({ id, resolve, reject }); return; }
    const batch: Waiter[] = [{ id, resolve, reject }]; batches.set(currency, batch);
    setTimeout(() => {
      batches.delete(currency);
      const ids = [...new Set(batch.map(w => w.id))];
      for (let start = 0; start < ids.length; start += 80) {
        const chunk = ids.slice(start, start + 80), waiters = batch.filter(w => chunk.includes(w.id));
        void api.prices(chunk, currency).then(quotes => { for (const w of waiters) quotes[w.id] ? w.resolve(quotes[w.id]) : w.reject(new Error('No market listing')); }).catch(e => waiters.forEach(w => w.reject(e)));
      }
    }, 40);
  });
}
