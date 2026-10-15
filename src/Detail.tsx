import { lazy, Suspense, useEffect, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { ArrowLeft, ArrowRight, ChevronRight, ExternalLink, FolderHeart, Heart, Layers2, Package, RefreshCw } from 'lucide-react';
import { api } from './api';
import { Price, preferredVariant } from './Price';
import { PriceHistory } from './PriceHistory';
import { AgentPatches } from './AgentPatches';
import { CashPrice } from './CashPrice';
import { Dialog, ItemImage, PaletteRow } from './components';
import { categoryLabels } from './types';
import type { Item, Reference, Saves } from './types';
const Viewer3D = lazy(() => import('./Viewer3D'));

function Pages({ page, pages, label, onChange }: { page: number; pages: number; label: string; onChange: (page: number) => void }) {
  if (pages <= 1) return null;
  return <div className="detail-pages"><button className="button" aria-label={`${label}: previous page`} disabled={page === 0} onClick={() => onChange(page - 1)}><ArrowLeft size={13} />Previous</button><span>Page {page + 1} of {pages}</span><button className="button" aria-label={`${label}: next page`} disabled={page + 1 >= pages} onClick={() => onChange(page + 1)}>Next<ArrowRight size={13} /></button></div>;
}
function ReferenceLinks({ label, references, onNavigate }: { label: string; references: Reference[]; onNavigate: (id: string) => void }) {
  const [page, setPage] = useState(0);
  const [items, setItems] = useState<Record<string, Item | null>>({});
  useEffect(() => { setPage(0); }, [references]);
  const pages = Math.max(1, Math.ceil(references.length / 4)); const currentPage = Math.min(page, pages - 1);
  useEffect(() => {
    let live = true; setItems({});
    void Promise.all(references.slice(currentPage * 4, currentPage * 4 + 4).map(async reference => [reference.id, await api.item(reference.id).catch(() => null)] as const)).then(entries => {
      if (live) setItems(Object.fromEntries(entries));
    });
    return () => { live = false; };
  }, [references, currentPage]);
  if (!references.length) return null;
  return <div className="detail-reference-group"><dt>{label}{references.length > 1 ? ` (${references.length})` : ''}</dt><dd><div className="detail-reference-links">{references.slice(currentPage * 4, currentPage * 4 + 4).map(reference => <button key={reference.id} className="detail-reference-link" aria-label={`Open ${reference.name}`} onClick={() => onNavigate(reference.id)}>{items[reference.id] ? <ItemImage item={items[reference.id]!} className="detail-reference-thumbnail" interactive={false} lazy /> : <span className="detail-reference-thumbnail detail-reference-placeholder" aria-hidden="true">{items[reference.id] === null ? <Package size={18} /> : <span className="image-skeleton" />}</span>}<span className="detail-reference-name">{reference.name}</span><ChevronRight size={12} /></button>)}</div><Pages page={currentPage} pages={pages} label={label} onChange={setPage} /></dd></div>;
}

type Tab = 'information' | 'lists' | 'contents';
export default function Detail({ item, saves, favorite, compared, onClose, onSave, onCompare, onColor, onNavigate, onError, currency, onCraft }: {
  onCraft: () => void; currency: string; item: Item; saves: Saves; favorite: boolean; compared: boolean; onClose: () => void;
  onSave: (action: string, id?: string | null, list?: number | null, name?: string | null) => Promise<boolean>;
  onCompare: () => void; onColor: (hex: string) => void; onNavigate: (id: string) => void; onError: (message: string) => void;
}) {
  const [wear, setWear] = useState(''); const [special, setSpecial] = useState('Normal'); const [imageAttempt, setImageAttempt] = useState(0);
  const [view3d, setView3d] = useState(false);
  const supports3d = ['skins', 'knives', 'gloves'].includes(item.category) && /^(skin|base):\d+/.test(item.id) || ['agents', 'charms'].includes(item.category) && Boolean(item.attributes['def index']);
  const [tab, setTab] = useState<Tab>('information'); const [relatedPage, setRelatedPage] = useState(0); const [listPage, setListPage] = useState(0);
  const [related, setRelated] = useState<Item[]>([]); const [relatedLoading, setRelatedLoading] = useState(false);
  useEffect(() => {
    const first = preferredVariant(item); setWear(first?.wear || ''); setSpecial(first?.special || 'Normal');
    setImageAttempt(0); setView3d(false); setTab('information'); setRelatedPage(0); setListPage(0);
  }, [item]);
  const relatedIds = item.contents;
  useEffect(() => {
    const ids = item.contents;
    let live = true; setRelatedLoading(true);
    void Promise.all(ids.slice(relatedPage * 6, relatedPage * 6 + 6).map(id => api.item(id).catch(() => null))).then(items => {
      if (live) { setRelated(items.filter((i): i is Item => i !== null)); setRelatedLoading(false); }
    });
    return () => { live = false; };
  }, [item, relatedPage]);
  const variant = item.variants.find(v => v.wear === wear && v.special === special);
  const wears = [...new Set(item.variants.map(v => v.wear))]; const specials = [...new Set(item.variants.filter(v => v.wear === wear).map(v => v.special))];
  const chooseWear = (value: string) => { setWear(value); if (!item.variants.some(v => v.wear === value && v.special === special)) setSpecial(item.variants.find(v => v.wear === value)?.special || 'Normal'); };
  const market = Boolean(variant?.marketHashName || (!item.variants.length && item.marketHashName));
  const facts = [['Category', categoryLabels[item.category] || item.category], ['Rarity', item.rarity], ['Weapon', item.weapon], ['Phase', item.phase], ['Effect', item.effect], ['Tournament', item.tournament], ['Team', item.team], ['Paint index', item.paintIndex], ...Object.entries(item.attributes).filter(([key]) => key !== 'paint index')].filter(([, value]) => value);
  const tabs: { id: Tab; label: string }[] = [{ id: 'information', label: 'Information' }, { id: 'lists', label: `Lists (${saves.lists.length})` }, ...(relatedIds.length ? [{ id: 'contents' as const, label: `Contents (${relatedIds.length})` }] : [])];
  const tabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = tabs.findIndex(t => t.id === tab);
    const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
    if (next < 0) return; event.preventDefault(); setTab(tabs[next].id); document.getElementById(`detail-tab-${tabs[next].id}`)?.focus();
  };
  const listPages = Math.max(1, Math.ceil(saves.lists.length / 8)); const visibleListPage = Math.min(listPage, listPages - 1);
  return <Dialog title="Item details" onClose={onClose} detail>
    <div className="detail-body">
      <div className="detail-visual">
        {supports3d && <div className="detail-view-toggle" aria-label="Preview mode"><button className={!view3d ? 'active' : ''} aria-pressed={!view3d} onClick={() => setView3d(false)}>Image</button><button className={view3d ? 'active' : ''} aria-pressed={view3d} onClick={() => setView3d(true)}>3D view</button></div>}
        {view3d && supports3d ? <Suspense fallback={<div className="detail-art">Loading 3D viewer…</div>}><Viewer3D key={item.id} item={item} /></Suspense> : <div className="detail-art"><ItemImage item={item} variantId={variant?.id || null} key={`${item.id}:${imageAttempt}`} /><button className="icon-button retry-art" onClick={() => setImageAttempt(value => value + 1)} aria-label="Reload item image"><RefreshCw size={14} /></button><span className="art-caption">Representative catalog image</span></div>}
        <div className="detail-heading"><span className="eyebrow">{categoryLabels[item.category] || 'Catalog item'}</span><h2>{item.name}</h2>{!item.active && <p className="notice">Archived source item · retained in your saved library.</p>}</div>
        <div className="detail-actions">{item.category === 'skins' && <button className="button" onClick={onCraft}>Craft with this skin</button>}<button className={`button ${favorite ? 'saved-button' : ''}`} onClick={() => void onSave(favorite ? 'unfavorite' : 'favorite', item.id)}><Heart size={16} fill={favorite ? 'currentColor' : 'none'} />{favorite ? 'Favorited' : 'Favorite'}</button><button className="button" onClick={onCompare}><Layers2 size={16} />{compared ? 'In comparison' : 'Compare'}</button></div>
        <section className="detail-section detail-palette"><h3>Appearance palette</h3><PaletteRow item={item} onColor={onColor} /><div className="detail-palette-labels">{item.palette.slice(0, 7).map(p => <span key={p.hex}>{p.hex}<small>{Math.round(p.weight * 100)}%</small></span>)}</div>{item.palette.length > 0 && <button className="text-button" onClick={() => onColor(item.palette[0].hex)}>Find similar colors <ArrowRight size={14} /></button>}<p className="muted small">Patterns, wear, and in-game lighting can change appearance.</p></section>
      </div>
      <div className="detail-properties">
        {item.category === 'agents' && item.rarity === 'Master' && <p className="master-badge">Master Agent · custom voice and celebration features</p>}
        {item.category === 'agents' && <AgentPatches agent={item} />}
        {item.variants.length > 0 && <section className="detail-section"><h3>Market variant</h3><div className="variant-fields"><label>Wear<select value={wear} onChange={e => chooseWear(e.target.value)}>{wears.map(w => <option key={w} value={w}>{w || 'No wear'}</option>)}</select></label><label>Special<select value={special} onChange={e => setSpecial(e.target.value)}>{specials.map(value => <option key={value}>{value}</option>)}</select></label></div></section>}
        <Price key={`${item.id}:${variant?.id || 'base'}`} item={item} variantId={variant?.id || null} currency={currency} />
        {market && <PriceHistory id={item.id} variantId={variant?.id || null} currency={currency} />}
        {market && <CashPrice id={item.id} variantId={variant?.id || null} currency={currency} />}
        <button className="button primary market-button" disabled={!market} onClick={() => { void api.market(item.id, variant?.id || null).catch(e => onError(String(e))); }}>Open Steam Market <ExternalLink size={15} /></button>{!market && <p className="muted small">This catalog item has no market listing.</p>}
        {item.minFloat !== null && item.maxFloat !== null && <section className="detail-section"><h3>Float range</h3><div className="float-numbers"><span>{item.minFloat.toFixed(4)}</span><span>{item.maxFloat.toFixed(4)}</span></div><div className="float-bar"><i style={{ left: `${item.minFloat * 100}%`, width: `${(item.maxFloat - item.minFloat) * 100}%` }} /></div><p className="muted small">Supported finish range. Individual item floats are not part of the catalog.</p></section>}
      </div>
      <div className="detail-sidebar">
        <div className="detail-tabs" role="tablist" aria-label="Item information sections">{tabs.map(t => <button key={t.id} id={`detail-tab-${t.id}`} role="tab" aria-selected={tab === t.id} aria-controls="detail-panel" tabIndex={tab === t.id ? 0 : -1} onClick={() => setTab(t.id)} onKeyDown={tabKey}>{t.label}</button>)}</div>
        <section id="detail-panel" className="detail-tab-panel" role="tabpanel" aria-labelledby={`detail-tab-${tab}`} tabIndex={0}>
          {tab === 'information' && <><h3>Item information</h3><dl className="detail-facts">{facts.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}<ReferenceLinks label="Collection" references={item.collections} onNavigate={onNavigate} /><ReferenceLinks label="Cases & containers" references={item.containers} onNavigate={onNavigate} /></dl>{item.description && <div className="detail-description"><h3>Description</h3><p className="description">{item.description}</p></div>}</>}
          {tab === 'lists' && <><h3>Add to a list</h3>{saves.lists.length ? <>{saves.lists.slice(visibleListPage * 8, visibleListPage * 8 + 8).map(list => { const added = saves.memberships[item.id]?.includes(list.id); return <label key={list.id} className="checkbox-row list-choice"><input type="checkbox" checked={!!added} onChange={() => void onSave(added ? 'remove' : 'add', item.id, list.id)} /><FolderHeart size={16} /><span>{list.name}</span></label>; })}<Pages page={visibleListPage} pages={listPages} label="Lists" onChange={setListPage} /></> : <p className="muted small">Create a list from the Library menu to organize your picks.</p>}</>}
          {tab === 'contents' && <><h3>Contents ({relatedIds.length})</h3><div className="related-items">{relatedLoading ? <p className="muted small">Loading contents…</p> : related.length ? related.map(relatedItem => <button key={relatedItem.id} onClick={() => onNavigate(relatedItem.id)}><ItemImage item={relatedItem} interactive={false} /><span>{relatedItem.name}</span><ChevronRight size={15} /></button>) : <p className="muted small">These items are unavailable in the current catalog.</p>}</div><Pages page={relatedPage} pages={Math.max(1, Math.ceil(relatedIds.length / 6))} label="Contents" onChange={setRelatedPage} /></>}
        </section>
      </div>
    </div>
  </Dialog>;
}
