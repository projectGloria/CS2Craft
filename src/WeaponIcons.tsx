import { useEffect, useRef, useState } from 'react';
import { Check, RefreshCw, Search } from 'lucide-react';
import { api } from './api';
import { ItemImage } from './components';
import type { Item, SearchResult } from './types';
import { emptyQuery } from './types';

export const weaponIconStorageKey = 'cs2-craft-weapon-icons';
export function readWeaponIconPreferences(): Record<string, string> {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(weaponIconStorageKey) || '{}');
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
    return Object.fromEntries(Object.entries(stored).filter(([weapon, id]) => weapon.length > 0 && typeof id === 'string' && id.length > 0));
  } catch { return {}; }
}

export function WeaponIconSettings({ icons, preferences, loading, error, onRetry, onChoose }: {
  icons: Record<string, Item>; preferences: Record<string, string>; loading: boolean; error: string;
  onRetry: () => void; onChoose: (weapon: string, item: Item | null) => void;
}) {
  const [selectedWeapon, setSelectedWeapon] = useState('AK-47');
  const [choosing, setChoosing] = useState(false); const [find, setFind] = useState('');
  const [result, setResult] = useState<SearchResult | null>(null);
  const [busy, setBusy] = useState(false); const [more, setMore] = useState(false); const [searchError, setSearchError] = useState('');
  const generation = useRef(0); const changeButton = useRef<HTMLButtonElement>(null);
  const weapons = Object.keys(icons).sort((a, b) => a.localeCompare(b));
  const weapon = icons[selectedWeapon] ? selectedWeapon : weapons[0] || '';
  const icon = icons[weapon];
  useEffect(() => {
    const token = ++generation.current;
    setResult(null); setSearchError(''); setMore(false);
    if (!choosing || !weapon) { setBusy(false); return; }
    setBusy(true);
    const timer = window.setTimeout(() => {
      void api.search({ ...emptyQuery, weapons: [weapon], text: find, sort: 'name', limit: 80 }).then(next => {
        if (token === generation.current) { setResult(next); setBusy(false); }
      }).catch(e => { if (token === generation.current) { setSearchError(String(e)); setBusy(false); } });
    }, 150);
    return () => { clearTimeout(timer); ++generation.current; };
  }, [choosing, weapon, find]);
  const loadMore = () => {
    if (!result || busy || more) return;
    const token = generation.current; setMore(true);
    void api.search({ ...emptyQuery, weapons: [weapon], text: find, sort: 'name', offset: result.items.length, limit: 80 }).then(next => {
      if (token === generation.current) setResult(old => old ? { ...next, items: [...old.items, ...next.items] } : next);
    }).catch(e => { if (token === generation.current) setSearchError(String(e)); }).finally(() => { if (token === generation.current) setMore(false); });
  };
  const choose = (item: Item) => { onChoose(weapon, item); setChoosing(false); setFind(''); changeButton.current?.focus(); };
  return <section className="weapon-icon-settings">
    <h3>Weapon icons</h3>
    <p className="muted">Choose the skin shown beside each weapon in the Weapon filter. Your choices are saved on this PC.</p>
    {error ? <div className="notice error">{error}<button className="text-button" onClick={onRetry}>Retry</button></div> : !icon ? <p className="muted">{loading ? 'Loading weapon icons…' : 'No weapon images available.'}</p> : <>
      <label className="weapon-icon-select">Weapon<select aria-label="Weapon icon weapon" value={weapon} onChange={e => { setSelectedWeapon(e.target.value); setChoosing(false); setFind(''); }}>
        {weapons.map(name => <option key={name} value={name}>{name}</option>)}
      </select></label>
      <div className="weapon-icon-current"><ItemImage item={icon} interactive={false} /><div><span>Current icon</span><strong>{icon.name}</strong></div></div>
      <div className="weapon-icon-actions"><button ref={changeButton} className="button" aria-expanded={choosing} onClick={() => { setChoosing(value => !value); setFind(''); }}>{choosing ? 'Close skin picker' : 'Choose skin'}</button>{preferences[weapon] && <button className="text-button" onClick={() => { onChoose(weapon, null); setChoosing(false); }}>Reset to automatic</button>}</div>
      {choosing && <div className="weapon-skin-picker">
        <label className="weapon-skin-search"><Search size={15} /><input autoFocus aria-label={`Find icon skin for ${weapon}`} placeholder="Find a skin…" value={find} onChange={e => setFind(e.target.value)} /></label>
        <div className="weapon-skin-scroll">
          {busy ? <p className="muted"><RefreshCw className="spin" size={14} /> Loading skins…</p> : <div className="weapon-skin-grid">{result?.items.filter(item => item.image).map(item => <button key={item.id} className={`weapon-skin-choice ${icon.id === item.id ? 'chosen' : ''}`} aria-pressed={icon.id === item.id} aria-label={`Use ${item.name} as ${weapon} icon`} title={item.name} onClick={() => choose(item)}><ItemImage item={item} interactive={false} lazy /><span>{item.name.includes(' | ') ? item.name.split(' | ').slice(1).join(' | ') : item.name}</span>{icon.id === item.id && <Check size={14} />}</button>)}</div>}
          {!busy && result?.total === 0 && <p className="muted">No matching skins.</p>}
          {searchError && <p className="notice error">{searchError}</p>}
          {result && result.items.length < result.total && <button className="button weapon-skin-more" disabled={busy || more} onClick={loadMore}>{more ? 'Loading…' : 'Load more skins'}</button>}
        </div>
      </div>}
    </>}
  </section>;
}
