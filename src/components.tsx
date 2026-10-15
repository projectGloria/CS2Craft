import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Heart, Layers2, RefreshCw, WifiOff, X } from 'lucide-react';
import { api } from './api';
import { Price } from './Price';
import type { Item } from './types';
import { categoryLabels } from './types';
export function TopPopover({ id, label, title = label, icon, count = 0, open, onToggle, onClose, width = 300, children, className = '' }: { id: string; label: string; title?: string; icon?: React.ReactNode; count?: number; open: boolean; onToggle: () => void; onClose: () => void; width?: number; children: React.ReactNode; className?: string }) {
  const trigger = useRef<HTMLButtonElement>(null); const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<React.CSSProperties>({ visibility: 'hidden' });
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const bounds = trigger.current?.getBoundingClientRect(); if (!bounds) return;
      const panelWidth = Math.min(width, window.innerWidth - 32);
      const below = window.innerHeight - bounds.bottom - 24, above = bounds.top - 24;
      const height = Math.min(440, panel.current?.scrollHeight || 440);
      const flip = below < Math.max(260, height) && above > below;
      const available = flip ? above : below;
      // When neither side fits a usable panel, use the viewport as the anchor.
      const cramped = available < 260;
      setPosition({ width: panelWidth, left: Math.max(16, Math.min(bounds.left, window.innerWidth - panelWidth - 16)), ...(cramped ? { top: 16, maxHeight: window.innerHeight - 32 } : flip ? { bottom: window.innerHeight - bounds.top + 8, maxHeight: above } : { top: bounds.bottom + 8, maxHeight: below }) });
    };
    place(); window.addEventListener('resize', place); return () => window.removeEventListener('resize', place);
  }, [open, width]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!panel.current?.contains(e.target as Node) && !trigger.current?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); trigger.current?.focus(); } };
    const focus = (e: FocusEvent) => { if (!panel.current?.contains(e.target as Node) && !trigger.current?.contains(e.target as Node)) onClose(); };
    const timer = setTimeout(() => { const first = panel.current?.querySelector<HTMLElement>('input:not([type="checkbox"])') || panel.current?.querySelector<HTMLElement>('button, input, select'); first?.focus(); }, 0);
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', key); document.addEventListener('focusin', focus);
    return () => { clearTimeout(timer); document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', key); document.removeEventListener('focusin', focus); };
  }, [open, onClose]);
  return <div className={`top-popover ${className}`}><button ref={trigger} className={`filter-button ${open ? 'open' : ''} ${count ? 'has-selection' : ''}`} aria-expanded={open} aria-controls={`popup-${id}`} onClick={onToggle}>{icon}<span>{label}</span>{count > 0 && <b>{count}</b>}<ChevronDown size={13} /></button>{open && createPortal(<div ref={panel} id={`popup-${id}`} className="top-popover-panel" style={position} role="dialog" aria-label={title}><header><h3>{title}</h3><button className="icon-button" aria-label={`Close ${title}`} onClick={() => { onClose(); trigger.current?.focus(); }}><X size={16} /></button></header>{children}</div>, document.body)}</div>;
}
export function ItemImage({ item, variantId = null, className = '', interactive = true, lazy = false }: { item: Item; variantId?: string | null; className?: string; interactive?: boolean; lazy?: boolean }) {
  const container = useRef<HTMLDivElement>(null); const [visible, setVisible] = useState(!lazy);
  useEffect(() => {
    if (!lazy || visible || !container.current) return;
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: '80px' });
    observer.observe(container.current); return () => observer.disconnect();
  }, [lazy, visible]);
  const [src, setSrc] = useState(''); const [failed, setFailed] = useState(false); const [attempt, retry] = useState(0);
  useEffect(() => { if (lazy && !visible) return; let live = true; setSrc(''); setFailed(false); api.image(item.id, variantId).then(s => { if (live) setSrc(s); }).catch(() => { if (live) setFailed(true); }); return () => { live = false; }; }, [item.id, variantId, attempt, lazy, visible]);
  return <div ref={container} className={`item-image ${className}`}>
    {src ? <img src={src} alt={item.name} draggable={false} onError={() => { setFailed(true); setSrc(''); }} /> : failed ? interactive ? <button className="image-retry" onClick={() => retry(v => v + 1)} aria-label={`Retry image for ${item.name}`}><WifiOff size={23} /><span>Image unavailable</span><small>Click to retry</small></button> : <span className="image-retry"><WifiOff size={23} /><span>Image unavailable</span></span> : <div className="image-skeleton" aria-label="Loading image" />}
  </div>;
}
export function PaletteRow({ item, onColor }: { item: Item; onColor?: (hex: string) => void }) {
  return <div className="palette-row" aria-label="Appearance palette">{item.palette.slice(0, 7).map(p => <button key={p.hex} style={{ background: p.hex }} title={`${p.hex} · ${Math.round(p.weight * 100)}%`} aria-label={`Search color ${p.hex}`} onClick={e => { e.stopPropagation(); onColor?.(p.hex); }} disabled={!onColor} />)}</div>;
}
export function ItemCard({ item, favorite, compared, onOpen, onFavorite, onCompare, onColor, currency, onContext }: { onContext: (x: number, y: number) => void; currency: string; item: Item; favorite: boolean; compared: boolean; onOpen: () => void; onFavorite: () => void; onCompare: () => void; onColor: (color: string) => void }) {
  const split = item.name.split(' | '); const title = split.length > 1 ? split.slice(1).join(' | ') : item.name;
  return <article onContextMenu={e => { e.preventDefault(); onContext(e.clientX, e.clientY); }} tabIndex={0} onKeyDown={e => { if (e.key === 'ContextMenu' || e.shiftKey && e.key === 'F10') { e.preventDefault(); const bounds = e.currentTarget.getBoundingClientRect(); onContext(bounds.left + 20, bounds.top + 20); } }} className={`item-card ${compared ? 'in-compare' : ''}`} style={{ '--rarity': item.rarityColor || '#79828a' } as React.CSSProperties}>
    <div className="card-actions"><button className={`icon-button ${favorite ? 'is-favorite' : ''}`} aria-label={`${favorite ? 'Unfavorite' : 'Favorite'} ${item.name}`} aria-pressed={favorite} onClick={onFavorite}><Heart size={16} fill={favorite ? 'currentColor' : 'none'} /></button><button className={`icon-button ${compared ? 'selected' : ''}`} aria-label={`${compared ? 'Remove from' : 'Add to'} comparison: ${item.name}`} aria-pressed={compared} onClick={onCompare}><Layers2 size={16} /></button></div>
    <button className="card-open" onClick={onOpen} aria-label={`View ${item.name}`}><ItemImage item={item} interactive={false} /><div className="card-copy"><span className="item-kind">{item.weapon || (split.length > 1 ? split[0] : categoryLabels[item.category] || 'Item')}{item.phase && ` · ${item.phase}`}</span><h3 title={title}>{title}</h3><span className="item-rarity"><i />{item.rarity || categoryLabels[item.category] || 'Item'}</span></div></button>
    <div className="card-badges">{item.stattrak && <span>StatTrak</span>}{item.souvenir && <span>Souvenir</span>}{!item.active && <span>Archived</span>}{item.minFloat !== null && item.maxFloat !== null && (item.minFloat > 0 || item.maxFloat < 1) && <span>Float {item.minFloat.toFixed(2)}–{item.maxFloat.toFixed(2)}</span>}{item.category === 'agents' && item.rarity === 'Master' && <span>Master Agent</span>}</div><Price item={item} currency={currency} compact /><div className="card-footer"><PaletteRow item={item} onColor={onColor} /><span className="mini-label">{!item.active ? 'Archived' : item.stattrak ? 'ST' : item.souvenir ? 'SOUV' : ''}</span></div>
  </article>;
}
export function Dialog({ title, onClose, children, wide = false, detail = false }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean; detail?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; if (!ref.current?.contains(document.activeElement)) ref.current?.focus(); const key = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); if (e.key === 'Tab') { const nodes = ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input, select, [tabindex="0"]'); if (!nodes?.length) return; const first = nodes[0], last = nodes[nodes.length - 1]; if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } } }; document.addEventListener('keydown', key); return () => { document.removeEventListener('keydown', key); previous?.focus(); }; }, []);
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div ref={ref} className={`dialog ${wide ? 'wide' : ''} ${detail ? 'item-detail-dialog' : ''}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}><header><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={20} /></button></header>{children}</div></div>;
}
export function Loading({ label = 'Loading catalog…' }: { label?: string }) { return <div className="loading"><RefreshCw className="spin" size={22} /><span>{label}</span></div>; }
