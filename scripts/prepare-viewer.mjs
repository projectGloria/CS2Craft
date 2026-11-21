import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
if (!fs.existsSync('tools/source2/Source2Viewer-CLI.exe')) {
  fs.mkdirSync('tools/source2', { recursive: true });
  const response = await fetch('https://github.com/ValveResourceFormat/ValveResourceFormat/releases/download/20.0/cli-windows-x64.zip');
  if (!response.ok) throw new Error('Could not download Source 2 Viewer. Install its official Windows CLI 20.0 into tools/source2.');
  fs.writeFileSync('tools/source2/cli.zip', Buffer.from(await response.arrayBuffer()));
  const quote = value => "'" + value.replaceAll("'", "''") + "'";
  const extraction = spawnSync('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath ${quote(path.resolve('tools/source2/cli.zip'))} -DestinationPath ${quote(path.resolve('tools/source2'))} -Force`], { windowsHide: true, encoding: 'utf8' });
  if (extraction.status !== 0) throw new Error(extraction.stderr || 'Could not extract Source 2 Viewer.');
  // The archive may nest its files in a subfolder; flatten them so the paths below always resolve.
  const root = path.resolve('tools/source2');
  const found = new Map();
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (!found.has(entry.name.toLowerCase())) found.set(entry.name.toLowerCase(), full);
    }
  };
  walk(root);
  for (const name of ['Source2Viewer-CLI.exe', 'libSkiaSharp.dll', 'spirv-cross.dll']) {
    const source = found.get(name.toLowerCase());
    if (!source) throw new Error(`${name} is missing from the Source 2 Viewer archive. Found: ${[...found.keys()].join(', ')}`);
    if (path.dirname(source) !== root) fs.copyFileSync(source, path.join(root, name));
  }
}
const out = 'src-tauri/resources/viewer'; fs.mkdirSync(out, { recursive: true });
// Package a private runtime; users do not need Node or any network connection.
fs.copyFileSync(process.execPath, path.join(out, 'node.exe'));
for (const name of ['Source2Viewer-CLI.exe', 'libSkiaSharp.dll', 'spirv-cross.dll']) fs.copyFileSync(path.join('tools/source2', name), path.join(out, name));
await build({ entryPoints: ['scripts/offline-viewer.mjs'], outfile: path.join(out, 'prepare.cjs'), platform: 'node', format: 'cjs', bundle: true, minify: true });
console.log('Offline viewer helper prepared.');
