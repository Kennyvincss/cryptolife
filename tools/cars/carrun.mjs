import { chromium } from 'playwright';
import fs from 'node:fs';
const S = '/tmp/claude-0/-home-user-cryptolife/b3cc1bfa-1dc4-5369-8030-2ef26014d3ac/scratchpad';
const cfgs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const mode = process.argv[3] ?? 'preview';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
page.on('pageerror', e => console.log('ERR', e.message));
page.on('console', m => { if (m.type() === 'error') console.log('CON', m.text().slice(0, 200)); });
await page.route('**/__carproc/**', r => { const f = r.request().url().split('/__carproc/')[1]; r.fulfill({ body: fs.readFileSync(S + '/carproc/' + f), contentType: f.endsWith('.html') ? 'text/html' : 'text/javascript' }); });
await page.route('**/__cars/**', r => { const f = decodeURIComponent(r.request().url().split('/__cars/')[1]); r.fulfill({ body: fs.readFileSync(S + '/assets/cars/cc-by_will-it-fit/' + f), contentType: 'model/gltf-binary' }); });
await page.goto('http://localhost:5180/__carproc/index.html');
await page.waitForFunction(() => window.procReady, null, { timeout: 60000 });
fs.mkdirSync(S + '/carout', { recursive: true });
for (const cfg of cfgs) {
  const res = await page.evaluate(async ([cfg, mode]) => {
    const { root, stats } = await window.proc.process(cfg);
    const out = { stats, png: window.proc.preview(root, 1.0) };
    if (mode === 'export') out.glb = await window.proc.exportGLB(root);
    return out;
  }, [cfg, mode]).catch(e => ({ err: e.message }));
  if (res.err) { console.log(cfg.id, 'ERR', res.err); continue; }
  fs.writeFileSync(`${S}/carout/${cfg.id}.png`, Buffer.from(res.png.split(',')[1], 'base64'));
  if (res.glb) fs.writeFileSync(`${S}/carout/${cfg.id}.raw.glb`, Buffer.from(res.glb, 'base64'));
  const st = res.stats;
  console.log(cfg.id, JSON.stringify({ tris: st.tris, wheels: st.wheelsFound, wheelTris: st.wheelTris, doorTris: st.doorTris, size: st.userData.size.map(x => +x.toFixed(2)), r: +st.userData.radius.toFixed(2) }));
  console.log('   ', st.roles.join(' '), 'paint', st.paintKey);
}
await browser.close();
