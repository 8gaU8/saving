import qrcode from 'qrcode-generator';
import jsQR from 'jsqr';
import './styles/main.css';
import { normalizeState } from './core/schema.js';
import { QR_MAX_CHUNKS, QR_RE, encodePayload, decodePayload, makeChunks } from './core/qrCodec.js';
import { probe } from './store/storage.js';
import { state, reload, watchOtherTabs } from './store/state.js';
import { $, reducedMotion } from './ui/dom.js';
import { ui } from './ui/uiState.js';
import { render } from './ui/render.js';
import { toast } from './ui/toast.js';
import { adoptState } from './ui/adopt.js';
import * as dialogs from './ui/dialogs.js';
import * as shiftForm from './ui/shiftForm.js';
import * as historyUI from './ui/history.js';
import * as savingsDialog from './ui/savingsDialog.js';
import * as setup from './ui/setup.js';
import * as settings from './ui/settings.js';
import * as jsonIO from './ui/jsonIO.js';

/* ---------- QRコード（書き出し／読み込み） ---------- */
/* --- 書き出し --- */
const dlgQrExport = $('#dlgQrExport');
let qrChunks = [], qrIdx = 0, qrTimer = null;

function qrSvg(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount(), quiet = 4, size = n + quiet * 2;
  let d = '';
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (!qr.isDark(r, c)) { c++; continue; }
      let len = 1;
      while (c + len < n && qr.isDark(r, c + len)) len++;
      d += `M${c + quiet} ${r + quiet}h${len}v1h-${len}z`;
      c += len;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
function showQr() {
  $('#qrView').innerHTML = qrSvg(qrChunks[qrIdx]);
  const n = qrChunks.length;
  $('#qrCount').textContent = n > 1 ? `${qrIdx + 1} / ${n}` : '1枚だけです';
  $('#qrView').setAttribute('aria-label', `データのQRコード（${qrIdx + 1}枚目、全${n}枚）`);
}
function stopQrPlay() {
  clearInterval(qrTimer);
  qrTimer = null;
  $('#qrPlay').textContent = '再生';
}
function startQrPlay() {
  if (qrChunks.length < 2) return;
  clearInterval(qrTimer);
  qrTimer = setInterval(() => { qrIdx = (qrIdx + 1) % qrChunks.length; showQr(); }, 1600);
  $('#qrPlay').textContent = '一時停止';
}
async function openQrExport() {
  $('#dlgSettings').close();
  try {
    qrChunks = makeChunks(await encodePayload(state));
    if (qrChunks.length > QR_MAX_CHUNKS) throw new Error('データが大きすぎてQRにできません。JSONで書き出してください。');
    qrIdx = 0;
    showQr();
  } catch (e) {
    toast(e.message || 'QRコードを作れませんでした。', true);
    return;
  }
  const n = qrChunks.length;
  $('#qrControls').hidden = n < 2;
  $('#qrHint').textContent = n < 2
    ? '読み込む端末で「QRで読み込み」を開き、このQRにカメラを向けてください。'
    : `読み込む端末で「QRで読み込み」を開き、カメラを向けてください。QRは全${n}枚で、自動で切り替わります。すべて読み取れるまで、この画面を開いたままにしてください。` +
      (n > 20 ? '枚数が多いときは、JSONでの書き出しのほうが確実です。' : '');
  dlgQrExport.showModal();
  if (reducedMotion()) stopQrPlay(); else startQrPlay();
}
$('#qrPrev').addEventListener('click', () => { stopQrPlay(); qrIdx = (qrIdx - 1 + qrChunks.length) % qrChunks.length; showQr(); });
$('#qrNext').addEventListener('click', () => { stopQrPlay(); qrIdx = (qrIdx + 1) % qrChunks.length; showQr(); });
$('#qrPlay').addEventListener('click', () => { if (qrTimer) stopQrPlay(); else startQrPlay(); });
dlgQrExport.addEventListener('close', () => { clearInterval(qrTimer); qrTimer = null; $('#qrView').innerHTML = ''; });
$('#qrExportBtn').addEventListener('click', openQrExport);

/* --- 読み込み --- */
const dlgQrImport = $('#dlgQrImport');
let scan = null;        // { sid, total, parts: Map(番号 -> データ) }
let camStream = null, scanTimer = null;
const scanCanvas = document.createElement('canvas');

function setQrStatus(msg, isErr = false) {
  const el = $('#qrStatus');
  el.textContent = msg;
  el.classList.toggle('err', isErr);
}
function renderDots() {
  const el = $('#qrDots');
  if (!scan) { el.innerHTML = ''; return; }
  let h = '';
  for (let i = 1; i <= scan.total; i++) h += `<i class="${scan.parts.has(i) ? 'on' : ''}"></i>`;
  el.innerHTML = h;
}
function stopCamera() {
  clearTimeout(scanTimer);
  scanTimer = null;
  if (camStream) camStream.getTracks().forEach((t) => t.stop());
  camStream = null;
  const v = $('#qrVideo');
  v.pause && v.pause();
  v.srcObject = null;
}

// 読み取った1枚分の文字列を取り込む。QRアプリのものでなければ false
function feedQr(text) {
  const m = QR_RE.exec(String(text).trim());
  if (!m) return false;
  const sid = m[1], idx = +m[2], total = +m[3], part = m[4];
  if (idx < 1 || idx > total || total > QR_MAX_CHUNKS) return false;
  if (!scan || scan.sid !== sid || scan.total !== total) scan = { sid, total, parts: new Map() };
  if (!scan.parts.has(idx)) {
    scan.parts.set(idx, part);
    if (navigator.vibrate) navigator.vibrate(30);
    renderDots();
    setQrStatus(total > 1 ? `読み取り中… ${scan.parts.size} / ${total}` : '読み取りました');
  }
  if (scan.parts.size === scan.total) finishScan();
  return true;
}

async function finishScan() {
  const sc = scan;
  scan = null;
  stopCamera();
  const payload = Array.from({ length: sc.total }, (_, i) => sc.parts.get(i + 1)).join('');
  let next;
  try {
    next = normalizeState(await decodePayload(payload));
  } catch (e) {
    setQrStatus((e.message || '読み込みに失敗しました。') + 'もう一度読み取ってください。', true);
    renderDots();
    startCamera(true);
    return;
  }
  dlgQrImport.close();
  await adoptState(next);
}

function scanTick() {
  if (!camStream) return;
  const v = $('#qrVideo');
  if (v.readyState >= 2 && v.videoWidth) {
    const sc = Math.min(1, 960 / v.videoWidth);
    const w = Math.round(v.videoWidth * sc), h = Math.round(v.videoHeight * sc);
    scanCanvas.width = w;
    scanCanvas.height = h;
    const cx = scanCanvas.getContext('2d', { willReadFrequently: true });
    cx.drawImage(v, 0, 0, w, h);
    try {
      const img = cx.getImageData(0, 0, w, h);
      const code = jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' });
      if (code) feedQr(code.data);
    } catch (_) { /* 1フレームの失敗では止めない */ }
  }
  if (camStream) scanTimer = setTimeout(scanTick, 120);
}

async function startCamera(keepStatus = false) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setQrStatus('このブラウザではカメラを使えません。「画像から読み込む」をお使いください。', true);
    return;
  }
  try {
    camStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false
    });
    const v = $('#qrVideo');
    v.srcObject = camStream;
    await v.play();
    if (!keepStatus && !scan) setQrStatus('QRコードにカメラを向けてください。');
  } catch (e) {
    stopCamera();
    setQrStatus(
      e && e.name === 'NotAllowedError'
        ? 'カメラの使用が許可されていません。ブラウザの設定で許可するか、「画像から読み込む」をお使いください。'
        : 'カメラを起動できませんでした。「画像から読み込む」をお使いください。', true);
    return;
  }
  scanTick();
}

function openQrImport() {
  $('#dlgSettings').close();
  scan = null;
  renderDots();
  setQrStatus('カメラを起動しています…');
  dlgQrImport.showModal();
  startCamera();
}
dlgQrImport.addEventListener('close', () => { stopCamera(); scan = null; });
$('#qrImportBtn').addEventListener('click', openQrImport);
$('#setupQr').addEventListener('click', openQrImport);

// 画像（スクリーンショットなど）からの読み取り
async function decodeImageFile(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => rej(new Error('image'));
      im.src = url;
    });
    const cx = scanCanvas.getContext('2d', { willReadFrequently: true });
    for (const maxSide of [2000, 1000, 640]) {
      const sc = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * sc)), h = Math.max(1, Math.round(img.naturalHeight * sc));
      scanCanvas.width = w;
      scanCanvas.height = h;
      cx.drawImage(img, 0, 0, w, h);
      const code = jsQR(cx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'attemptBoth' });
      if (code) return code.data;
    }
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}
$('#qrPickImage').addEventListener('click', () => $('#qrImageInput').click());
$('#qrImageInput').addEventListener('change', async (e) => {
  const files = Array.from(e.target.files || []);
  e.target.value = '';
  if (!files.length) return;
  let found = 0;
  for (const f of files) {
    setQrStatus('画像を読み取っています…');
    let text = null;
    try { text = await decodeImageFile(f); } catch (_) { /* 次の画像へ */ }
    if (text && feedQr(text)) found++;
    if (!dlgQrImport.open) return; // 読み取り完了で閉じた
  }
  setQrStatus(
    found ? `${found}枚のQRを読み取りました。` + (scan && scan.parts.size < scan.total ? `あと${scan.total - scan.parts.size}枚です。` : '')
          : '画像からQRコードを読み取れませんでした。QR全体が写っているか確認してください。',
    !found);
});

/* ---------- 起動 ---------- */
for (const m of [dialogs, shiftForm, historyUI, savingsDialog, setup, settings, jsonIO]) m.init();
probe();
reload();
shiftForm.resetShiftForm();
render();

// 日付をまたいで開きっぱなしでも、戻ってきたときに計算し直す
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
// 別タブでの変更を反映する
watchOtherTabs(() => {
  ui.editingId = null;
  render();
});
