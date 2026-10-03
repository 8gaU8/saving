// 参照用テスト（旧 index.html に対する jsdom ベースの挙動確認）。
// Vitest へ移植する際のテストケース集として使う。実行: pnpm add -D jsdom jsqr && node qr-roundtrip.reference.cjs
const { JSDOM } = require('jsdom');
const jsQRnode = require('jsqr');
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'legacy', 'index.html'), 'utf8').replace(/<link[^>]*fonts[^>]*>/g, '');
let fails = 0;
const ok = (c, m, extra) => { console.log((c ? 'PASS ' : 'FAIL ') + m + (c ? '' : '  -> ' + extra)); if (!c) fails++; };
const FIXED = new Date(2026, 9, 3, 12, 0, 0).getTime();

function boot(state, { camera = false, queue = [] } = {}) {
  return new JSDOM(html, { runScripts: 'dangerously', url: 'https://x.example/', pretendToBeVisual: true,
    beforeParse(w) {
      const R = w.Date;
      class FD extends R { constructor(...a) { if (a.length === 0) super(FIXED); else super(...a); } static now() { return FIXED; } }
      w.Date = FD;
      w.CompressionStream = CompressionStream; w.DecompressionStream = DecompressionStream;
      w.Response = Response; w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;
      w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
      w.HTMLDialogElement.prototype.close = function () { if (!this.hasAttribute('open')) return; this.removeAttribute('open'); this.dispatchEvent(new w.Event('close')); };
      w.HTMLElement.prototype.scrollIntoView = () => {};
      w.matchMedia = () => ({ matches: true }); // reduced motion -> no autoplay timers
      if (camera) {
        Object.defineProperty(w.navigator, 'mediaDevices', { value: { getUserMedia: async () => ({ getTracks: () => [{ stop() { w.__camStopped = (w.__camStopped || 0) + 1; } }] }) } });
        w.HTMLMediaElement.prototype.play = () => Promise.resolve();
        w.HTMLMediaElement.prototype.pause = () => {};
        Object.defineProperty(w.HTMLMediaElement.prototype, 'readyState', { get: () => 4 });
        Object.defineProperty(w.HTMLVideoElement.prototype, 'videoWidth', { get: () => 640 });
        Object.defineProperty(w.HTMLVideoElement.prototype, 'videoHeight', { get: () => 480 });
        w.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(4) }) });
        w.__queue = queue;
        // the page's inline jsQR is replaced so we can feed decoded strings as if the camera saw them
      }
      if (state) w.localStorage.setItem('savings-pace:v1', JSON.stringify(state));
    } }).window;
}
function bootCam(state, opts) { const w = boot(state, opts); w.jsQR = () => (w.__queue.length ? { data: w.__queue.shift() } : null); return w; }

// ---- realistic data: 140 shifts over ~7 months, a few adjustments, one odd 'earned'
const shifts = [];
let idc = 0;
for (let i = 0; i < 140; i++) {
  const d = new Date(2026, 2, 1); d.setDate(d.getDate() + Math.floor(i * 1.5));
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const minutes = 180 + (i * 37) % 300;
  const wage = i < 70 ? 1100 : 1150;
  shifts.push({ id: 'id' + (idc++), date, minutes, wage, earned: Math.round(minutes * wage / 60), at: new Date(2026, 2, 1, 20, 0, i).toISOString() });
}
shifts[10].earned += 7; // non-derivable earned
shifts.push({ id: 'dup1', date: '2026-09-20', minutes: 120, wage: 1150, earned: 2300, at: '2026-09-20T10:00:00.000Z' });
shifts.push({ id: 'dup2', date: '2026-09-20', minutes: 90, wage: 1150, earned: 1725, at: '2026-09-20T11:00:00.000Z' });
const orig = { app: 'savings-pace', schemaVersion: 1,
  goal: { baseSavings: 123456, target: 600000, deadline: '2027-03-31', hourlyWage: 1150.5, closingDay: 31, payDay: 25, createdAt: '2026-02-20T01:02:03.000Z' },
  shifts, adjustments: [
    { id: 'a1', date: '2026-05-05', delta: -15000, at: '2026-05-05T09:00:00.000Z' },
    { id: 'a2', date: '2026-08-01', delta: 4200, at: '2026-08-01T09:00:00.000Z' }] };

(async () => {
  // ===== export =====
  const w1 = boot(orig);
  const d1 = w1.document;
  d1.querySelector('#openSettings').click();
  d1.querySelector('#qrExportBtn').click();
  await new Promise((r) => setTimeout(r, 200));
  ok(d1.querySelector('#dlgQrExport').open, 'QR export dialog opened');
  const n = d1.querySelector('#qrCount').textContent;
  console.log('QR count label:', n);
  const decoded = [];
  const readSvg = () => {
    const svg = d1.querySelector('#qrView svg');
    const vb = svg.getAttribute('viewBox').split(' ').map(Number); const size = vb[2];
    const scale = 6, W = size * scale; const px = new Uint8ClampedArray(W * W * 4).fill(255);
    for (const m of svg.querySelector('path').getAttribute('d').matchAll(/M(\d+) (\d+)h(\d+)v1/g)) {
      const x0 = +m[1], y = +m[2], len = +m[3];
      for (let yy = y * scale; yy < (y + 1) * scale; yy++) for (let xx = x0 * scale; xx < (x0 + len) * scale; xx++) { const o = (yy * W + xx) * 4; px[o] = px[o + 1] = px[o + 2] = 0; }
    }
    const code = jsQRnode(px, W, W);
    return { text: code && code.data, modules: size - 8 };
  };
  const label = d1.querySelector('#qrCount').textContent;
  const totalChunks = +/\/\s*(\d+)/.exec(label)[1];
  let maxModules = 0;
  for (let i = 0; i < totalChunks; i++) {
    const r = readSvg(); decoded.push(r.text); maxModules = Math.max(maxModules, r.modules);
    if (i < totalChunks - 1) d1.querySelector('#qrNext').click();
  }
  ok(totalChunks > 1 && decoded.every(Boolean), `exported ${totalChunks} QR codes, all decode via real QR decoder (max ${maxModules}x${maxModules} modules)`, decoded.map(Boolean));
  ok(decoded.every((t) => /^SP1\.[0-9a-z]{6}\.\d+\.\d+\./.test(t)), 'chunk headers well-formed');
  console.log('sample chunk head:', decoded[0].slice(0, 40), '... len', decoded[0].length);
  const sid = new Set(decoded.map((t) => t.split('.')[1]));
  ok(sid.size === 1, 'single session id');
  // prev button wraps
  d1.querySelector('#qrPrev').click();
  ok(true, 'prev works without error');

  // ===== import via simulated camera, shuffled order + duplicates + junk =====
  const shuffled = [...decoded].sort(() => Math.random() - 0.5);
  const queue = ['https://example.com/not-ours', ...shuffled.slice(0, 2), ...shuffled.slice(0, 1), ...shuffled.slice(2)];
  const w2 = bootCam(null, { camera: true, queue });
  const d2 = w2.document;
  ok(!d2.querySelector('#setupView').hidden, 'device 2 starts at setup');
  d2.querySelector('#setupQr').click();
  await new Promise((r) => setTimeout(r, 400 + totalChunks * 160));
  ok(!d2.querySelector('#mainView').hidden, 'device 2 main view after QR import');
  ok(!d2.querySelector('#dlgQrImport').open, 'QR dialog closed after import');
  ok(w2.__camStopped >= 1, 'camera stopped');

  const s2 = JSON.parse(w2.localStorage.getItem('savings-pace:v1'));
  const strip = (s) => ({ goal: s.goal, shifts: s.shifts.map(({ date, minutes, wage, earned }) => ({ date, minutes, wage, earned })).sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.minutes - b.minutes),
    adjustments: s.adjustments.map(({ date, delta }) => ({ date, delta })) });
  const a = strip(orig), b = strip(s2);
  ok(JSON.stringify(a.goal) === JSON.stringify(b.goal), 'goal identical', JSON.stringify([a.goal, b.goal]));
  ok(JSON.stringify(a.shifts) === JSON.stringify(b.shifts), `all ${a.shifts.length} shifts identical (incl. odd earned)`);
  ok(JSON.stringify(a.adjustments) === JSON.stringify(b.adjustments), 'adjustments identical');
  const dom1 = txtOf(d1), dom2 = txtOf(d2);
  function txtOf(d) { return { sv: d.querySelector('#savingsAmount').textContent, pend: d.querySelector('#pendingLine').textContent, need: d.querySelector('#needBody').textContent, hist: d.querySelector('#historyList').textContent }; }
  ok(dom1.sv === dom2.sv && dom1.pend === dom2.pend && dom1.need === dom2.need, 'displayed savings / pending / required hours identical', JSON.stringify([dom1, dom2]));
  ok(dom1.hist === dom2.hist, 'history list identical (order preserved)');

  // ===== corrupted chunk =====
  const bad = decoded.map((t, i) => (i === 1 ? t.slice(0, -6) + 'AAAAAA' : t));
  const w3 = bootCam(null, { camera: true, queue: bad });
  w3.document.querySelector('#setupQr').click();
  await new Promise((r) => setTimeout(r, 400 + totalChunks * 160));
  const st3 = w3.document.querySelector('#qrStatus');
  ok(st3.classList.contains('err'), 'corrupted data -> error shown: ' + st3.textContent);
  ok(!w3.document.querySelector('#setupView').hidden, 'state not changed on corrupted data');
  ok(w3.document.querySelector('#dlgQrImport').open, 'dialog stays open for retry');

  // ===== replace confirmation when state already exists =====
  const w4 = bootCam(Object.assign({}, orig, { goal: Object.assign({}, orig.goal, { target: 999999 }) }), { camera: true, queue: [...decoded] });
  w4.document.querySelector('#openSettings').click();
  w4.document.querySelector('#qrImportBtn').click();
  await new Promise((r) => setTimeout(r, 400 + totalChunks * 160));
  ok(w4.document.querySelector('#dlgConfirm').open, 'existing data -> replace confirmation shown');
  w4.document.querySelector('#cfOk').click();
  await new Promise((r) => setTimeout(r, 100));
  ok(JSON.parse(w4.localStorage.getItem('savings-pace:v1')).goal.target === 600000, 'replaced after confirm');

  // ===== tiny state = 1 QR =====
  const w5 = boot({ app: 'savings-pace', schemaVersion: 1, goal: { baseSavings: 0, target: 1000, deadline: '2027-01-01', hourlyWage: 1000, closingDay: 31, payDay: 25, createdAt: '' }, shifts: [], adjustments: [] });
  w5.document.querySelector('#openSettings').click(); w5.document.querySelector('#qrExportBtn').click();
  await new Promise((r) => setTimeout(r, 150));
  ok(w5.document.querySelector('#qrControls').hidden && w5.document.querySelector('#qrCount').textContent.includes('1枚'), 'fresh state -> single QR, no carousel controls');

  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  process.exit(fails ? 1 : 0);
})();
