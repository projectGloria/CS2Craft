import { spawn } from 'node:child_process';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const targetUrl = 'http://127.0.0.1:1420/';
const outputDir = resolve('docs/assets');
if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

const edge = spawn(edgePath, [
  '--headless=new',
  '--remote-debugging-port=9222',
  '--no-sandbox',
  '--disable-gpu',
  '--window-size=1440,900',
  'about:blank'
]);

await new Promise(r => setTimeout(r, 1200));

try {
  const pageRes = await fetch('http://127.0.0.1:9222/json/new?' + encodeURIComponent(targetUrl), { method: 'PUT' });
  const pageData = await pageRes.json();
  const ws = new WebSocket(pageData.webSocketDebuggerUrl);

  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  let id = 1;
  const send = (method, params = {}) => new Promise((resolve) => {
    const curId = id++;
    const handler = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id === curId) {
        ws.removeEventListener('message', handler);
        resolve(msg.result);
      }
    };
    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({ id: curId, method, params }));
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false
  });

  const evalJs = async (expression) => {
    const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    return res.result?.value;
  };

  const capture = async (name) => {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const file = resolve(outputDir, name);
    writeFileSync(file, Buffer.from(shot.data, 'base64'));
    console.log(`Saved ${name} (${Math.round(shot.data.length * 0.75 / 1024)} KB)`);
  };

  // Wait for catalog load
  await new Promise(r => setTimeout(r, 3500));
  await capture('catalog-preview.png');

  // Open item detail
  console.log('Opening item detail...');
  const detailClicked = await evalJs(`(() => {
    const card = document.querySelector('.card-open');
    if (card) { card.click(); return true; }
    return false;
  })()`);
  console.log('detail clicked:', detailClicked);
  await new Promise(r => setTimeout(r, 2000));
  await capture('item-detail-preview.png');

  // Close detail
  await evalJs(`(() => {
    const x = document.querySelector('.modal-backdrop button.icon-button');
    if (x) x.click();
  })()`);
  await new Promise(r => setTimeout(r, 1000));

  // Open Trade-up Calculator
  console.log('Opening Trade-Up...');
  await evalJs(`(() => {
    const craftBtn = document.querySelector('button[aria-controls="popup-craft-tools"]');
    if (craftBtn) craftBtn.click();
  })()`);
  await new Promise(r => setTimeout(r, 800));
  await evalJs(`(() => {
    const btns = Array.from(document.querySelectorAll('.library-menu .nav-link'));
    const t = btns.find(b => b.textContent.includes('Trade-up'));
    if (t) t.click();
  })()`);
  await new Promise(r => setTimeout(r, 2000));
  await capture('tradeup-preview.png');

  // Close Trade-up
  await evalJs(`(() => {
    const x = document.querySelector('.modal-backdrop button.icon-button');
    if (x) x.click();
  })()`);
  await new Promise(r => setTimeout(r, 1000));

  // Open Sticker & Charm studio
  console.log('Opening Craft Studio...');
  await evalJs(`(() => {
    const craftBtn = document.querySelector('button[aria-controls="popup-craft-tools"]');
    if (craftBtn) craftBtn.click();
  })()`);
  await new Promise(r => setTimeout(r, 800));
  await evalJs(`(() => {
    const btns = Array.from(document.querySelectorAll('.library-menu .nav-link'));
    const s = btns.find(b => b.textContent.includes('Sticker'));
    if (s) s.click();
  })()`);
  await new Promise(r => setTimeout(r, 2000));
  await capture('craft-studio-preview.png');

  // Close Craft Studio
  await evalJs(`(() => {
    const x = document.querySelector('.modal-backdrop button.icon-button');
    if (x) x.click();
  })()`);
  await new Promise(r => setTimeout(r, 1000));

  // Open CT/T Loadouts
  console.log('Opening Loadout...');
  await evalJs(`(() => {
    const craftBtn = document.querySelector('button[aria-controls="popup-craft-tools"]');
    if (craftBtn) craftBtn.click();
  })()`);
  await new Promise(r => setTimeout(r, 800));
  await evalJs(`(() => {
    const btns = Array.from(document.querySelectorAll('.library-menu .nav-link'));
    const l = btns.find(b => b.textContent.includes('Loadout') || b.textContent.includes('loadout'));
    if (l) l.click();
  })()`);
  await new Promise(r => setTimeout(r, 2000));
  await capture('loadout-preview.png');

  ws.close();
} catch (err) {
  console.error('Error:', err);
} finally {
  edge.kill();
}
