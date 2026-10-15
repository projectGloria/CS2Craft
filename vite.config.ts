import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
export default defineConfig({ plugins: [react(), {
  name: 'local-catalog-preview',
  configureServer(server) {
    let cached: any = null; let modified = 0;
    server.middlewares.use((req, res, next) => {
      if (!req.url?.startsWith('/__preview/')) return next();
      const bundledPath = resolve('src-tauri/resources/catalog.json');
      const pendingPath = resolve('.catalog-cache/normalized.json');
      const catalogPath = statSync(bundledPath).size < 500 && existsSync(pendingPath) ? pendingPath : bundledPath;
      if (req.url === '/__preview/catalog.json') { res.setHeader('Content-Type', 'application/json'); createReadStream(catalogPath).pipe(res); return; }
      if (req.url.startsWith('/__preview/model')) {
        const url = new URL(req.url, 'http://localhost');
        const data = JSON.parse(readFileSync(catalogPath, 'utf8'));
        const item = data.items.find((i: any) => i.id === url.searchParams.get('id'));
        const match = item?.id.match(/^(?:skin|base):(\d+)(?::(\d+))?/);
        if (!item || !['skins', 'knives', 'gloves', 'agents', 'charms'].includes(item.category) || (!match && !item.attributes?.['def index'])) { res.statusCode = 400; res.end('Unsupported item'); return; }
        const args = { vpk: 'C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive/game/csgo/pak01_dir.vpk', cache: resolve('.catalog-cache/viewer'), cli: resolve('tools/source2/Source2Viewer-CLI.exe'), category: item.category, defIndex: Number(match?.[1] || item.attributes['def index']), paintIndex: Number(match?.[2] || 0) };
        execFile(process.execPath, ['scripts/offline-viewer.mjs', '--prepare', JSON.stringify(args)], { windowsHide: true, timeout: 240000 }, (error, stdout, stderr) => {
          if (error) { res.statusCode = 500; res.end(stderr || String(error)); return; }
          const result = JSON.parse(stdout);
          if (url.pathname === '/__preview/model.glb') { res.setHeader('Content-Type', 'model/gltf-binary'); createReadStream(result.path).pipe(res); }
          else { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ...result, path: `/__preview/model.glb?id=${encodeURIComponent(item.id)}` })); }
        }); return;
      }
      try {
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname !== '/__preview/image') { res.statusCode = 404; res.end(); return; }
        const mtime = statSync(catalogPath).mtimeMs;
        if (!cached || modified !== mtime) { cached = JSON.parse(readFileSync(catalogPath, 'utf8')); modified = mtime; }
        const item = cached.items.find((i: any) => i.id === url.searchParams.get('id'));
        const variant = url.searchParams.get('variant');
        const image = variant ? item?.variants.find((v: any) => v.id === variant)?.image : item?.image;
        if (!image) { res.statusCode = 404; res.end(); return; }
        const path = resolve('.catalog-cache/images', createHash('sha256').update(image).digest('hex') + '.png');
        if (!existsSync(path)) { res.statusCode = 404; res.end(); return; }
        res.setHeader('Content-Type', 'image/png'); res.setHeader('Cache-Control', 'max-age=3600'); createReadStream(path).pipe(res);
      } catch { res.statusCode = 500; res.end(); }
    });
  }
}], optimizeDeps: { entries: ['index.html'], noDiscovery: true, include: ['react', 'react-dom/client', '@tanstack/react-virtual', 'lucide-react', '@tauri-apps/api/core', 'three'] }, clearScreen: false, server: { port: 1420, strictPort: true }, build: { target: 'es2022' } });
