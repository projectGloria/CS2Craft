// Local-only Source 2 asset conversion. No network or Steam account access.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { PNG } from 'pngjs';

export function parseKeyValues(text) {
  const tokens = (text.match(/"(?:\\.|[^"\\])*"|\/\/[^\n]*|[{}]|[^\s{}"]+/g) || []).filter(t => !t.startsWith('//') && !t.startsWith('[$'));
  let cursor = 0;
  const read = () => { const token = tokens[cursor++]; return token?.startsWith('"') ? token.slice(1, -1).replace(/\\"/g, '"') : token; };
  const merge = (a, b) => { for (const [key, value] of Object.entries(b)) a[key] = typeof value === 'object' && typeof a[key] === 'object' ? merge(a[key], value) : value; return a; };
  const object = () => { const result = {}; while (cursor < tokens.length) { const key = read(); if (key === '}') break; const value = read(); const parsed = value === '{' ? object() : value; result[key] = typeof parsed === 'object' && typeof result[key] === 'object' ? merge(result[key], parsed) : parsed; } return result; };
  return object();
}
export function parseMaterial(text) {
  const result = {};
  for (const match of text.matchAll(/m_name\s*=\s*"([^"]+)"\s+m_(?:nValue|flValue|pValue|value)\s*=\s*(resource:)?("[^"]*"|\[[^\]]*\]|[-\d.eE+]+)/g)) {
    const value = match[3]; result[match[1]] = value.startsWith('"') ? value.slice(1, -1).replaceAll('\\\\', '/') : value.startsWith('[') ? value.slice(1, -1).split(',').map(Number) : Number(value);
  }
  return result;
}
const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
const lerp = (a, b, t) => a + (b - a) * t;
const linear = x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4;
const srgb = x => x <= .0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - .055;
export function paintCoverage(noPaint, alpha, style) {
  const durability = style === 6 ? Math.min(1, alpha / 128) : 1;
  let coverage = clamp((1 - noPaint * durability - .5) * 2);
  if (alpha > 128) coverage *= 1 - clamp(1 - Math.abs(alpha - 191.5) / 63.5);
  return coverage;
}
function resize(image, n = 1024) {
  const data = Buffer.alloc(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const src = (Math.floor(y * image.height / n) * image.width + Math.floor(x * image.width / n)) * 4;
    image.data.copy(data, (y * n + x) * 4, src, src + 4);
  }
  return { width: n, height: n, data };
}
const pngBytes = image => PNG.sync.write(image, { colorType: 6 });

export function prepare({ vpk, cache, cli, defIndex, paintIndex, category = 'skins' }) {
  fs.mkdirSync(cache, { recursive: true });
  const cliVersion = fs.statSync(cli);
  const version = `${fs.statSync(vpk).size}:${fs.statSync(vpk).mtimeMs}:${cliVersion.size}:${cliVersion.mtimeMs}:7`;
  const revision = crypto.createHash('sha256').update(version).digest('hex').slice(0, 12);
  const root = path.join(cache, revision); fs.mkdirSync(root, { recursive: true });
  if (!['skins', 'knives', 'gloves', 'agents', 'charms'].includes(category)) throw new Error('Unsupported model category.');
  const output = path.join(root, `${category}-${defIndex}-${paintIndex}.glb`);
  const metadata = output + '.json';
  if (fs.existsSync(output) && fs.existsSync(metadata)) return JSON.parse(fs.readFileSync(metadata, 'utf8'));
  const run = args => {
    const result = spawnSync(cli, ['-i', vpk, ...args], { windowsHide: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 180000 });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      const detail = (result.stderr || result.stdout || '').slice(-2000);
      if (/vcsFileVersion|VCS file versions|UnexpectedMagicException/.test(detail)) throw new Error('The installed CS2 shaders are newer than this Source 2 Viewer build supports. Update the official CLI when a compatible release is available. The catalog image remains available.');
      throw new Error('CS2 asset export failed. Your game files may need updating. ' + detail.slice(-500));
    }
    return result.stdout;
  };
  const itemFile = path.join(root, 'items_game.txt');
  if (!fs.existsSync(itemFile)) run(['-f', 'scripts/items/items_game.txt', '-o', itemFile]);
  const game = parseKeyValues(fs.readFileSync(itemFile, 'utf8')).items_game;
  const resolve = (item, seen = new Set()) => {
    let inherited = {};
    for (const name of (item?.prefab || '').split(' ')) {
      if (!name || seen.has(name)) continue; seen.add(name);
      inherited = { ...inherited, ...resolve(game.prefabs?.[name], seen) };
    }
    return { ...inherited, ...item };
  };
  const weapon = category === 'charms' ? game.keychain_definitions?.[String(defIndex)] : resolve(game.items?.[String(defIndex)]);
  const model = weapon?.model_player || weapon?.model_world || weapon?.pedestal_display_model;
  if (!model || !/^(weapons|agents)\//.test(model)) throw new Error('This model is missing from your installed CS2 files. Update CS2 and try again.');
  const paint = game.paint_kits?.[String(paintIndex)];
  if (paintIndex && !paint) throw new Error('This finish is missing from your installed CS2 version. Update CS2 and try again.');
  const folder = path.join(root, `model-${category}-${defIndex}`); fs.mkdirSync(folder, { recursive: true });
  const rawFile = path.join(folder, 'model.glb');
  if (!fs.existsSync(rawFile)) run(['-f', model + '_c', '-o', rawFile, '-d', '--gltf_export_format', 'glb', '--gltf_export_materials', '--gltf_textures_adapt']);
  if (!fs.existsSync(rawFile)) throw new Error('This weapon model could not be exported from CS2.');
  const raw = fs.readFileSync(rawFile), jsonSize = raw.readUInt32LE(12);
  const doc = JSON.parse(raw.toString('utf8', 20, 20 + jsonSize));
  const body = paint?.use_legacy_model === '1' ? 'legacy' : 'hd';
  let meshIndex = doc.meshes.findIndex(m => m.name.endsWith('.body_' + body));
  if (meshIndex < 0) meshIndex = doc.meshes.findIndex(m => /\.body_(hd|legacy)$/.test(m.name));
  if (meshIndex < 0) meshIndex = 0;
  const selected = doc.meshes[meshIndex];
  if (category === 'skins' || category === 'knives') {
    for (const node of doc.nodes) if (node.mesh !== undefined && node.mesh !== meshIndex) { delete node.mesh; delete node.skin; }
    selected.primitives = selected.primitives.filter(p => !/sticker_gaps/.test(doc.materials[p.material]?.name || ''));
  }
  // Keep the original binary offsets, then append embedded textures to it.
  const chunks = [raw.subarray(28 + jsonSize, 28 + jsonSize + raw.readUInt32LE(20 + jsonSize))];
  let length = chunks[0].length;
  const append = bytes => {
    const aligned = Buffer.alloc(Math.ceil(bytes.length / 4) * 4); bytes.copy(aligned);
    const index = doc.bufferViews.length; doc.bufferViews.push({ buffer: 0, byteOffset: length, byteLength: bytes.length }); chunks.push(aligned); length += aligned.length; return index;
  };
  const texture = bytes => {
    const source = doc.images.length; doc.images.push({ bufferView: append(bytes), mimeType: 'image/png' });
    const index = doc.textures.length; doc.textures.push({ source }); return index;
  };
  const images = path.join(root, 'textures'); fs.mkdirSync(images, { recursive: true });
  const loadTexture = name => {
    if (!name) throw new Error('Required finish texture is missing.');
    const file = path.join(images, crypto.createHash('sha256').update(name).digest('hex') + '.png');
    try { if (!fs.existsSync(file)) run(['-f', name.replace(/_c$/, '') + '_c', '-d', '-o', file]); }
    catch (error) { throw new Error(`Could not extract finish texture ${name}: ${error.message}`); }
    if (!fs.existsSync(file)) throw new Error('Required CS2 texture could not be exported.');
    return PNG.sync.read(fs.readFileSync(file));
  };
  const material = name => {
    const file = path.join(images, crypto.createHash('sha256').update(name).digest('hex') + '.json');
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
    let params;
    try { params = parseMaterial(run(['-f', name.replace(/_c$/, '') + '_c', '-b', 'DATA'])); }
    catch (error) { throw new Error(`Could not read material ${name}: ${error.message}`); }
    if (!Object.keys(params).length) throw new Error('The installed CS2 material format is not supported.');
    fs.writeFileSync(file, JSON.stringify(params)); return params;
  };
  let painted = false, reason = category === 'gloves' && paintIndex ? 'Glove model with base materials. This glove finish requires a projection shader that is not supported yet.' : '';
  if (paintIndex && category !== 'gloves') { try {
    const p = material(`materials/models/weapons/customization/paints/vmats/${paint.name}.vmat`);
    const style = p.F_PAINT_STYLE;
    // Position-projected finishes require Source 2's full paint shader. Never
    // substitute a UV-painted approximation and label it as the selected skin.
    if (![1, 3, 4, 6, 8].includes(style)) reason = 'This finish needs a paint shader that is not supported yet. Showing the base weapon model.';
    else {
      const mainIndex = selected.primitives.find(p => !/shared_scope/.test(doc.materials[p.material]?.name || ''))?.material;
      const main = doc.materials[mainIndex];
      const source = main?.extras?.vmat;
      if (!source) throw new Error('This model has no supported material information.');
      const sourcePath = source.Name.replaceAll('\\', '/');
      const legacyMatch = sourcePath.match(/materials\/models\/weapons\/v_models\/([^/]+)\//);
      const inputPath = legacyMatch ? `materials/models/weapons/customization/${legacyMatch[1]}/${legacyMatch[1]}_composite_inputs.vmat` : path.posix.join(path.posix.dirname(sourcePath), 'composite_inputs', path.posix.basename(sourcePath, '.vmat') + '_composite_inputs.vmat');
      let q;
      try { q = material(inputPath); }
      catch (error) {
        // Knife inputs omit the "weapon_" prefix used by their model material.
        if (!sourcePath.startsWith('weapons/models/knife/')) throw error;
        q = material(inputPath.replace(/\/weapon_([^/]+)_composite_inputs\.vmat$/, '/$1_composite_inputs.vmat'));
      }
      const n = 1024;
      const original = resize(loadTexture(q.g_tColor), n);
      const masks = resize(loadTexture(q.g_tMasks), n);
      const ao = resize(loadTexture(q.g_tAmbientOcclusion), n);
      const metal = resize(loadTexture(q.g_tMetalness), n);
      const surface = q.g_tSurface ? resize(loadTexture(q.g_tSurface), n) : null;
      const pattern = p.g_tPattern ? loadTexture(p.g_tPattern) : { width: 1, height: 1, data: Buffer.from([...(p.g_vColor0 || [0, 0, 0]).slice(0, 3).map(v => Math.round(clamp(v) * 255)), 255]) };
      const colors = Array.from({ length: 4 }, (_, i) => (p['g_vColor' + i] || [0, 0, 0]).slice(0, 3).map(linear));
      const albedo = { width: n, height: n, data: Buffer.alloc(n * n * 4) }, orm = { width: n, height: n, data: Buffer.alloc(n * n * 4) };
      const angle = (p.g_flPatternTexCoordRotation || 0) * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle), scale = p.g_flPatternTexCoordScale || 1;
      const offset = p.g_vPatternTexCoordOffset || [0, 0];
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const i = (y * n + x) * 4, u = (x + .5) / n, v = (y + .5) / n;
        const px = Math.floor((((u * cos - v * sin) * scale + offset[0]) % 1 + 1) % 1 * pattern.width);
        const py = Math.floor((((u * sin + v * cos) * scale + offset[1]) % 1 + 1) % 1 * pattern.height);
        const k = (py * pattern.width + px) * 4, alpha = pattern.data[k + 3];
        const noPaint = (q.F_SEPARATE_CHANNEL_INPUTS ? surface?.data[i + 3] ?? 0 : ao.data[i + 3]) / 255;
        let strength = paintCoverage(noPaint, alpha, style), color = [pattern.data[k], pattern.data[k + 1], pattern.data[k + 2]], paintMetal = 0, roughness = p.g_flPaintRoughness ?? .5;
        if ([1, 3, 4].includes(style)) {
          const red = masks.data[i] / 255, green = masks.data[i + 1] / 255, blue = masks.data[i + 2] / 255;
          color = colors[0].slice();
          if (style === 4) for (let layer = 0; layer < 3; layer++) for (let c = 0; c < 3; c++) color[c] = lerp(color[c], colors[layer + 1][c], pattern.data[k + layer] / 255);
          for (let c = 0; c < 3; c++) color[c] = srgb(clamp(lerp(lerp(color[c], colors[2][c], green * (1 - red)), colors[3][c], blue * (1 - red)) * (p.g_flColorBrightness || 1))) * 255;
          if (style !== 1) { strength *= clamp(red + (green + blue) * metal.data[i] / 255); paintMetal = 1; }
        } else if (style === 8) { paintMetal = clamp(metal.data[i] / 255 * .7 + masks.data[i] / 255 * .3); }
        if ([3, 4, 8].includes(style) && alpha < 128) roughness = clamp(1 - alpha / 127, .075, 1);
        for (let c = 0; c < 3; c++) albedo.data[i + c] = Math.round(lerp(original.data[i + c], color[c], strength));
        albedo.data[i + 3] = 255;
        orm.data[i] = q.F_SEPARATE_CHANNEL_INPUTS ? ao.data[i] : ao.data[i + 1];
        orm.data[i + 1] = Math.round(lerp(metal.data[i], roughness * 255, strength));
        orm.data[i + 2] = Math.round(lerp(metal.data[i], paintMetal * 255, strength)); orm.data[i + 3] = 255;
      }
      const baseTexture = texture(pngBytes(albedo)), ormTexture = texture(pngBytes(orm));
      const normalName = p.F_OVERRIDE_NORMAL && p.g_tNormal ? p.g_tNormal : source.TextureParams?.g_tNormal;
      let normalTexture;
      if (normalName) {
        const normal = resize(loadTexture(normalName), n);
        for (let i = 0; i < normal.data.length; i += 4) normal.data[i + 1] = 255 - normal.data[i + 1];
        normalTexture = texture(pngBytes(normal));
      }
      for (const primitive of selected.primitives) {
        const m = doc.materials[primitive.material]; if (/shared_scope/.test(m.name || '')) continue;
        m.pbrMetallicRoughness = { baseColorTexture: { index: baseTexture }, metallicRoughnessTexture: { index: ormTexture }, metallicFactor: 1, roughnessFactor: 1 };
        m.occlusionTexture = { index: ormTexture };
        if (normalTexture !== undefined) m.normalTexture = { index: normalTexture };
      }
      painted = true;
    }
  } catch (error) {
    // Re-read the unmodified GLB: partial texture appends must never leak into a fallback.
    return baseFallback(raw, folder, output, metadata, error);
  }
  }
  for (const image of doc.images) if (image.uri) {
    const local = path.join(folder, image.uri);
    if (!fs.existsSync(local)) throw new Error('An exported model texture is missing. Try rebuilding this preview.');
    image.bufferView = append(pngBytes(resize(PNG.sync.read(fs.readFileSync(local))))); image.mimeType = 'image/png'; delete image.uri;
  }
  for (const m of doc.materials) delete m.extras;
  doc.asset.generator = 'CS2 Craft offline viewer · Source 2 Viewer';
  doc.buffers = [{ byteLength: length }];
  const json = Buffer.from(JSON.stringify(doc)), paddedJson = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32); json.copy(paddedJson);
  const bin = Buffer.concat(chunks); const header = Buffer.alloc(20); header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + paddedJson.length + bin.length, 8); header.writeUInt32LE(paddedJson.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  const binHeader = Buffer.alloc(8); binHeader.writeUInt32LE(bin.length, 0); binHeader.writeUInt32LE(0x004e4942, 4);
  fs.writeFileSync(output + '.tmp', Buffer.concat([header, paddedJson, binHeader, bin])); fs.renameSync(output + '.tmp', output);
  const result = { path: output, painted, note: painted ? 'Clean finish texture from installed CS2. Pattern seeds, stickers, and special effects are not simulated.' : reason || `${category === 'skins' || category === 'knives' ? 'Base weapon' : category === 'agents' ? 'Agent' : category === 'charms' ? 'Charm' : 'Glove'} model and materials from your installed CS2 files.` };
  fs.writeFileSync(metadata, JSON.stringify(result)); return result;
}

export function baseFallback(raw, folder, output, metadata, error) {
  const size = raw.readUInt32LE(12), doc = JSON.parse(raw.toString('utf8', 20, 20 + size));
  if (doc.images?.some(image => image.uri)) throw new Error(`Finish preparation failed: ${error.message}. Return to the catalog image; the base model requires external textures.`);
  fs.writeFileSync(output + '.tmp', raw); fs.renameSync(output + '.tmp', output);
  const result = { path: output, painted: false, note: `Base model fallback. The selected finish could not be prepared: ${error.message}` };
  fs.writeFileSync(metadata, JSON.stringify(result)); return result;
}

if (process.argv[2] === '--prepare') {
  try { console.log(JSON.stringify(prepare(JSON.parse(process.argv[3])))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
