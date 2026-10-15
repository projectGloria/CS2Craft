import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Item, Saves } from './types';
export function CardMenu({ item, x, y, saves, onClose, onOpen, onMarket, onColor, onTradeUp, onList }: { item: Item; x: number; y: number; saves: Saves; onClose: () => void; onOpen: () => void; onMarket: () => void; onColor: () => void; onTradeUp: () => void; onList: (id: number) => void }) {
  const ref = useRef<HTMLDivElement>(null); const [lists, setLists] = useState(false); const [position, setPosition] = useState({ left: x, top: y });
  useLayoutEffect(() => { const rect = ref.current?.getBoundingClientRect(); if (rect) setPosition({ left: Math.max(16, Math.min(x, window.innerWidth - rect.width - 16)), top: Math.max(16, Math.min(y, window.innerHeight - rect.height - 16)) }); }, [x, y, lists]);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const outside = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) onClose(); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onClose(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', key); window.addEventListener('resize', onClose);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', key); window.removeEventListener('resize', onClose); };
  }, [onClose, lists]);
  const action = (fn: () => void) => { onClose(); fn(); };
  return <div ref={ref} className="context-menu" style={position} role="menu" aria-label={`Actions for ${item.name}`} onKeyDown={e => { if (!['ArrowUp', 'ArrowDown'].includes(e.key)) return; e.preventDefault(); const nodes = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')], at = nodes.indexOf(document.activeElement as HTMLButtonElement); nodes[(at + (e.key === 'ArrowDown' ? 1 : -1) + nodes.length) % nodes.length]?.focus(); }}>
    {lists ? <><button role="menuitem" onClick={() => setLists(false)}>← Back</button>{saves.lists.map(list => <button key={list.id} role="menuitem" onClick={() => action(() => onList(list.id))}>{list.name}</button>)}{!saves.lists.length && <p className="muted small">Create a list in Library first.</p>}</> : <><button role="menuitem" onClick={() => action(onOpen)}>Open details</button><button role="menuitem" onClick={() => setLists(true)}>Add to list…</button><button role="menuitem" disabled={item.category !== 'skins' || !item.collections.length || !['Consumer Grade', 'Industrial Grade', 'Mil-Spec Grade', 'Restricted', 'Classified'].includes(item.rarity)} onClick={() => action(onTradeUp)}>Add to trade-up</button><button role="menuitem" disabled={!item.marketHashName && !item.variants.length} onClick={() => action(onMarket)}>Open Steam Market</button><button role="menuitem" disabled={!item.palette.length} onClick={() => action(onColor)}>Find matching colors</button></>}
  </div>;
}
