import jsQR from 'jsqr';
import { $ } from './dom.js';
import { normalizeState } from '../core/schema.js';
import { QR_MAX_CHUNKS, QR_RE, decodePayload } from '../core/qrCodec.js';
import { adoptState } from './adopt.js';

const dlgQrImport = $('#dlgQrImport');
let scan = null; // { sid, total, parts: Map(番号 -> データ) }
let camStream = null,
  scanTimer = null;
const scanCanvas = document.createElement('canvas');

function setQrStatus(msg, isErr = false) {
  const el = $('#qrStatus');
  el.textContent = msg;
  el.classList.toggle('err', isErr);
}
function renderDots() {
  const el = $('#qrDots');
  if (!scan) {
    el.innerHTML = '';
    return;
  }
  let h = '';
  for (let i = 1; i <= scan.total; i++) h += `<i class="${scan.parts.has(i) ? 'on' : ''}"></i>`;
  el.innerHTML = h;
}
function stopCamera() {
  clearTimeout(scanTimer);
  scanTimer = null;
  if (camStream)
    camStream.getTracks().forEach((t) => {
      t.stop();
    });
  camStream = null;
  const v = $('#qrVideo');
  v.pause?.();
  v.srcObject = null;
}

// 読み取った1枚分の文字列を取り込む。QRアプリのものでなければ false
function feedQr(text) {
  const m = QR_RE.exec(String(text).trim());
  if (!m) return false;
  const sid = m[1],
    idx = +m[2],
    total = +m[3],
    part = m[4];
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
    const w = Math.round(v.videoWidth * sc),
      h = Math.round(v.videoHeight * sc);
    scanCanvas.width = w;
    scanCanvas.height = h;
    const cx = scanCanvas.getContext('2d', { willReadFrequently: true });
    cx.drawImage(v, 0, 0, w, h);
    try {
      const img = cx.getImageData(0, 0, w, h);
      const code = jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' });
      if (code) feedQr(code.data);
    } catch (_) {
      /* 1フレームの失敗では止めない */
    }
  }
  if (camStream) scanTimer = setTimeout(scanTick, 120);
}

async function startCamera(keepStatus = false) {
  if (!navigator.mediaDevices?.getUserMedia) {
    setQrStatus('このブラウザではカメラを使えません。「画像から読み込む」をお使いください。', true);
    return;
  }
  try {
    camStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
      audio: false,
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
        : 'カメラを起動できませんでした。「画像から読み込む」をお使いください。',
      true,
    );
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
      const w = Math.max(1, Math.round(img.naturalWidth * sc)),
        h = Math.max(1, Math.round(img.naturalHeight * sc));
      scanCanvas.width = w;
      scanCanvas.height = h;
      cx.drawImage(img, 0, 0, w, h);
      const code = jsQR(cx.getImageData(0, 0, w, h).data, w, h, {
        inversionAttempts: 'attemptBoth',
      });
      if (code) return code.data;
    }
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function init() {
  dlgQrImport.addEventListener('close', () => {
    stopCamera();
    scan = null;
  });
  $('#qrImportBtn').addEventListener('click', openQrImport);
  $('#setupQr').addEventListener('click', openQrImport);
  $('#qrPickImage').addEventListener('click', () => $('#qrImageInput').click());
  $('#qrImageInput').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    let found = 0;
    for (const f of files) {
      setQrStatus('画像を読み取っています…');
      let text = null;
      try {
        text = await decodeImageFile(f);
      } catch (_) {
        /* 次の画像へ */
      }
      if (text && feedQr(text)) found++;
      if (!dlgQrImport.open) return; // 読み取り完了で閉じた
    }
    setQrStatus(
      found
        ? `${found}枚のQRを読み取りました。` +
            (scan && scan.parts.size < scan.total
              ? `あと${scan.total - scan.parts.size}枚です。`
              : '')
        : '画像からQRコードを読み取れませんでした。QR全体が写っているか確認してください。',
      !found,
    );
  });
}
