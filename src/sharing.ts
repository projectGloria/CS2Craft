import type { Item } from './types';
export function download(name: string, content: BlobPart, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export function shareCode(kind: string, payload: unknown) { return `CS2CRAFT:${kind}:1:` + btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(payload)))); }
export function parseCode(code: string, kind: string): unknown {
  const prefix = `CS2CRAFT:${kind}:1:`; if (!code.startsWith(prefix) || code.length > 200000) throw new Error('Invalid CS2 Craft configuration code.');
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(code.slice(prefix.length)), c => c.charCodeAt(0))));
}
export function listExport(name: string, items: Item[], format: 'json' | 'csv' | 'md') {
  if (format === 'json') return JSON.stringify({ schema: 'cs2-craft-list', version: 1, name, items: items.map(i => ({ id: i.id, name: i.name })) }, null, 2);
  const csv = (s: string) => '"' + (/^[=+\-@\t\r]/.test(s) ? "'" + s : s).replaceAll('"', '""') + '"';
  if (format === 'csv') return ['id,name,weapon,rarity', ...items.map(i => [i.id, i.name, i.weapon, i.rarity].map(csv).join(','))].join('\r\n');
  return `# ${name.replace(/[\r\n]/g, ' ')}\n\n` + items.map(i => `- ${i.name.replace(/[\r\n]/g, ' ')} (${i.id})`).join('\n');
}
export function numericPrice(value: string | null | undefined): number | null {
  if (!value || value.includes('-')) return null;
  const digits = value.replace(/[^0-9.,]/g, ''); const pos = Math.max(digits.lastIndexOf('.'), digits.lastIndexOf(','));
  const decimal = pos >= 0 && digits.length - pos - 1 <= 2;
  const n = Number(decimal ? digits.slice(0, pos).replace(/[.,]/g, '') + '.' + digits.slice(pos + 1) : digits.replace(/[.,]/g, ''));
  return digits && Number.isFinite(n) && n >= 0 ? n : null;
}
