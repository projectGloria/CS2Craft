import { useState } from 'react';
import { ArrowLeft, BarChart3, Search, Trash2 } from 'lucide-react';
import { ItemImage } from './components';
import { filterLabels } from './browsing';
import { topUsage } from './usage';
import type { UsageEntry, UsageStatistics } from './usage';
import type { Item } from './types';

const groupLabels = { ...filterLabels, colors: 'Colors', sorts: 'Sort order', items: 'Viewed items' };
export const sortLabels: Record<string, string> = { relevance: 'Relevance', name: 'Name A–Z', price_asc: 'Price: low to high', price_desc: 'Price: high to low' };
function UsageRows({ entries, icons }: { entries: UsageEntry[]; icons?: Record<string, Item> }) {
  const max = entries[0]?.count || 1;
  return <div className="usage-rows">{entries.length ? entries.map(entry => <div className="usage-row" key={entry.value} title={`Last used ${new Date(entry.lastUsed).toLocaleString()}${entry.selections || entry.searches ? ` · ${entry.selections} selections · ${entry.searches} searches` : ''}`}>
    {icons?.[entry.value] && <ItemImage item={icons[entry.value]} className="weapon-thumbnail" interactive={false} lazy />}
    <div className="usage-row-copy"><div><span>{entry.label}</span><strong>{entry.count.toLocaleString()}</strong></div><div className="usage-meter" aria-hidden="true"><i style={{ width: `${entry.count / max * 100}%` }} /></div></div>
  </div>) : <p className="usage-empty">Your activity will appear here as you browse.</p>}</div>;
}
export function Statistics({ stats, icons, onBack, onClear }: { stats: UsageStatistics; icons: Record<string, Item>; onBack: () => void; onClear: () => void }) {
  const [group, setGroup] = useState('categories'); const [confirmClear, setConfirmClear] = useState(false);
  const weapons = topUsage(stats, 'weapons'); const searches = topUsage(stats, 'searches'); const viewed = topUsage(stats, 'items');
  const selections = Object.values(stats.groups).flatMap(entries => Object.values(entries)).reduce((sum, entry) => sum + entry.selections, 0);
  const totalSearches = searches.reduce((sum, entry) => sum + entry.count, 0);
  const totalViews = viewed.reduce((sum, entry) => sum + entry.count, 0);
  return <main className="usage-page">
    <header className="usage-header"><div><span className="eyebrow"><BarChart3 size={15} />PERSONAL ACTIVITY</span><h1>Your statistics</h1><p>Since {new Date(stats.startedAt).toLocaleDateString()} · saved on this PC</p></div><button className="button" onClick={onBack}><ArrowLeft size={15} />Back to catalog</button></header>
    <div className="usage-summary"><div><span>Catalog searches</span><strong>{totalSearches.toLocaleString()}</strong></div><div><span>Choices made</span><strong>{selections.toLocaleString()}</strong></div><div><span>Items viewed</span><strong>{totalViews.toLocaleString()}</strong></div><div><span>Most-used weapon</span><strong className="usage-summary-weapon">{weapons[0]?.label || '—'}</strong></div></div>
    <div className="usage-panels">
      <section className="usage-panel"><header><h2>Most-used weapons</h2><span>Selections + searches</span></header><UsageRows entries={weapons.slice(0, 10)} icons={icons} /></section>
      <section className="usage-panel"><header><h2><Search size={15} />Frequent searches</h2><span>{totalSearches.toLocaleString()} searches</span></header><UsageRows entries={searches.slice(0, 10)} /></section>
      <section className="usage-panel"><header><h2>Common choices</h2><select aria-label="Statistics filter group" value={group} onChange={e => setGroup(e.target.value)}>{Object.entries(groupLabels).filter(([key]) => key !== 'items').map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></header><UsageRows entries={topUsage(stats, group).slice(0, 10)} icons={group === 'weapons' ? icons : undefined} /></section>
      <section className="usage-panel"><header><h2>Most-viewed items</h2><span>{totalViews.toLocaleString()} views</span></header><UsageRows entries={viewed.slice(0, 10)} /></section>
    </div>
    <footer className="usage-footer"><div><h2>How filter priority works</h2><p>Selected options come first, followed by your most-used choices. Weapon priority includes catalog searches naming that weapon. Search activity is counted after you pause typing or press Enter. Rankings update the next time you open a filter.</p><p>Activity is stored locally. Statistics start from this update; earlier activity cannot be reconstructed.</p></div><button className="text-button" onClick={() => setConfirmClear(true)}><Trash2 size={14} />Clear statistics</button></footer>
    {confirmClear && <div className="notice usage-clear"><p>Clear your activity counts and restart filter rankings? Your browsing preferences and weapon icons will stay saved.</p><button className="button" onClick={() => { onClear(); setConfirmClear(false); }}>Clear statistics</button><button className="text-button" onClick={() => setConfirmClear(false)}>Cancel</button></div>}
  </main>;
}
