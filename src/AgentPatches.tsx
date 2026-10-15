import { useEffect, useState } from 'react';
import { api } from './api';
import { ItemImage } from './components';
import { ItemPicker } from './ItemPicker';
import type { Item } from './types';
export function AgentPatches({ agent }: { agent: Item }) {
  const [patches, setPatches] = useState<(Item | null)[]>([null, null, null]); const [selected, setSelected] = useState<number | null>(null); const [ready, setReady] = useState(false); const [error, setError] = useState('');
  const key = `cs2-craft-agent-patches:${agent.id}`;
  useEffect(() => { let live = true; setReady(false); setSelected(null); void Promise.resolve().then(async () => {
    const raw: unknown = JSON.parse(localStorage.getItem(key) || '[null,null,null]'); if (!Array.isArray(raw) || raw.length !== 3 || raw.some(id => id !== null && typeof id !== 'string')) throw new Error('Invalid saved patch plan.');
    const items = await Promise.all(raw.map(id => id ? api.item(id).catch(() => null) : null)); if (live) { setPatches(items.map(i => i?.category === 'patches' ? i : null)); setReady(true); }
  }).catch(() => { if (live) { setPatches([null, null, null]); setReady(true); } }); return () => { live = false; }; }, [key]);
  useEffect(() => { if (ready) { try { localStorage.setItem(key, JSON.stringify(patches.map(i => i?.id || null))); } catch { setError('Could not save the patch plan.'); } } }, [key, patches, ready]);
  return <section className="detail-section"><h3>Agent patch planner</h3><div className="agent-patches">{patches.map((patch, n) => <button key={n} onClick={() => setSelected(n)}>{patch ? <><ItemImage item={patch} interactive={false} /><span>{patch.name}</span></> : `+ Patch ${n + 1}`}</button>)}</div><p className="muted small">Plan up to three patches. The catalog does not describe this agent’s exact slot geometry; check compatibility in CS2.</p>{selected !== null && <><button className="text-button" onClick={() => { setPatches(p => p.map((i, n) => n === selected ? null : i)); setSelected(null); }}>Clear slot</button><ItemPicker categories={['patches']} onPick={item => { setPatches(p => p.map((i, n) => n === selected ? item : i)); setSelected(null); }} /></>}{error && <p className="notice">{error}</p>}</section>;
}
