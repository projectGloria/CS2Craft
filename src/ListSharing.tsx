import { useState } from 'react';
import { api } from './api';
import { Dialog } from './components';
import type { Item, Saves } from './types';
import { download, listExport, parseCode, shareCode } from './sharing';
export default function ListSharing({ saves, onSaves, onClose }: { saves: Saves; onSaves: (saves: Saves) => void; onClose: () => void }) {
  const [selected, setSelected] = useState('favorites'); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false); const [code, setCode] = useState('');
  const getList = async () => { const id = Number(selected); const name = selected === 'favorites' ? 'Favorites' : saves.lists.find(l => l.id === id)?.name || 'List'; const ids = selected === 'favorites' ? saves.favorites : Object.keys(saves.memberships).filter(itemId => saves.memberships[itemId].includes(id)); const items: Item[] = await Promise.all(ids.map(id => api.item(id))); return { name, items }; };
  const exportList = async (format: 'json' | 'csv' | 'md' | 'code') => {
    setBusy(true); setMessage(''); try { const list = await getList(); if (format === 'code') { await navigator.clipboard.writeText(shareCode('list', { name: list.name, ids: list.items.map(i => i.id) })); setMessage('List code copied.'); } else download(`cs2-list.${format}`, listExport(list.name, list.items, format), format === 'csv' ? 'text/csv;charset=utf-8' : format === 'md' ? 'text/markdown;charset=utf-8' : 'application/json'); } catch (e) { setMessage(String(e)); } finally { setBusy(false); }
  };
  const importList = async (raw: unknown) => {
    setBusy(true); setMessage(''); try {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid list file.');
      const data = raw as { name?: unknown; ids?: unknown; schema?: unknown; version?: unknown; items?: unknown };
      const ids = Array.isArray(data.ids) ? data.ids : data.schema === 'cs2-craft-list' && data.version === 1 && Array.isArray(data.items) ? data.items.map(i => i && typeof i === 'object' ? (i as { id: unknown }).id : null) : null;
      if (typeof data.name !== 'string' || !ids || ids.some(id => typeof id !== 'string')) throw new Error('Expected a CS2 Craft list with a name and catalog identifiers.');
      onSaves(await api.importList(data.name, ids as string[])); setMessage(`Imported ${new Set(ids).size} items into “${data.name}”.`);
    } catch (e) { setMessage(String(e)); } finally { setBusy(false); }
  };
  return <Dialog title="Export, import & share lists" onClose={onClose}><div className="suite-body"><label>Export list<select value={selected} onChange={e => setSelected(e.target.value)}><option value="favorites">Favorites</option>{saves.lists.map(l => <option value={l.id} key={l.id}>{l.name}</option>)}</select></label><div className="list-share-controls">{(['json', 'csv', 'md', 'code'] as const).map(format => <button className="button" key={format} disabled={busy} onClick={() => void exportList(format)}>{format === 'code' ? 'Copy share code' : format.toUpperCase()}</button>)}</div><label className="code-import">Import a CS2 Craft JSON list<input type="file" accept=".json,application/json" disabled={busy} onChange={e => { const file = e.target.files?.[0]; if (!file) return; if (file.size > 2000000) { setMessage('List file exceeds 2 MB.'); return; } void file.text().then(text => importList(JSON.parse(text))).catch(e => setMessage(String(e))); e.target.value = ''; }} /></label><label className="code-import">Or paste a shared list code<textarea value={code} onChange={e => setCode(e.target.value)} placeholder="CS2CRAFT:list:1:…" /><button className="button" disabled={busy} onClick={() => { try { void importList(parseCode(code.trim(), 'list')); } catch (e) { setMessage(String(e)); } }}>Import code</button></label><p className="muted small">Imported lists are created as new lists. Existing lists and favorites are preserved. Files reference catalog identifiers; they do not transfer item ownership.</p>{message && <p className="notice" role="status">{message}</p>}</div></Dialog>;
}
