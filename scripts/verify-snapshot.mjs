import { readFileSync } from 'node:fs';
const snapshot = JSON.parse(readFileSync(new URL('../src-tauri/resources/catalog.json', import.meta.url), 'utf8'));
if (snapshot.schemaVersion !== 1 || !/^[a-f0-9]{40}$/.test(snapshot.revision) || snapshot.items.length < 1000) throw new Error('Prepare a complete pinned catalog before packaging.');
const ids = new Set();
for (const item of snapshot.items) {
  if (!item.id || !item.name || ids.has(item.id) || !item.palette?.length) throw new Error(`Invalid or unindexed catalog item: ${item.id}`);
  ids.add(item.id);
  for (const p of item.palette) if (!/^#[a-f0-9]{6}$/i.test(p.hex) || !p.lab.every(Number.isFinite) || !(p.weight > 0 && p.weight <= 1)) throw new Error(`Invalid palette: ${item.id}`);
}
console.log(`Verified ${ids.size.toLocaleString()} color-indexed entries from ${snapshot.revision.slice(0, 12)}.`);
