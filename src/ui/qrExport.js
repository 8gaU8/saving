import qrcode from 'qrcode-generator';
import { $, reducedMotion } from './dom.js';
import { QR_MAX_CHUNKS, encodePayload, makeChunks } from '../core/qrCodec.js';
import { state } from '../store/state.js';
import { toast } from './toast.js';

const dlgQrExport = $('#dlgQrExport');
let qrChunks = [],
  qrIdx = 0,
  qrTimer = null;

function qrSvg(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount(),
    quiet = 4,
    size = n + quiet * 2;
  let d = '';
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (!qr.isDark(r, c)) {
        c++;
        continue;
      }
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
  qrTimer = setInterval(() => {
    qrIdx = (qrIdx + 1) % qrChunks.length;
    showQr();
  }, 1600);
  $('#qrPlay').textContent = '一時停止';
}
async function openQrExport() {
  $('#dlgSettings').close();
  try {
    qrChunks = makeChunks(await encodePayload(state));
    if (qrChunks.length > QR_MAX_CHUNKS)
      throw new Error('データが大きすぎてQRにできません。JSONで書き出してください。');
    qrIdx = 0;
    showQr();
  } catch (e) {
    toast(e.message || 'QRコードを作れませんでした。', true);
    return;
  }
  const n = qrChunks.length;
  $('#qrControls').hidden = n < 2;
  $('#qrHint').textContent =
    n < 2
      ? '読み込む端末で「QRで読み込み」を開き、このQRにカメラを向けてください。'
      : `読み込む端末で「QRで読み込み」を開き、カメラを向けてください。QRは全${n}枚で、自動で切り替わります。すべて読み取れるまで、この画面を開いたままにしてください。` +
        (n > 20 ? '枚数が多いときは、JSONでの書き出しのほうが確実です。' : '');
  dlgQrExport.showModal();
  if (reducedMotion()) stopQrPlay();
  else startQrPlay();
}

export function init() {
  $('#qrPrev').addEventListener('click', () => {
    stopQrPlay();
    qrIdx = (qrIdx - 1 + qrChunks.length) % qrChunks.length;
    showQr();
  });
  $('#qrNext').addEventListener('click', () => {
    stopQrPlay();
    qrIdx = (qrIdx + 1) % qrChunks.length;
    showQr();
  });
  $('#qrPlay').addEventListener('click', () => {
    if (qrTimer) stopQrPlay();
    else startQrPlay();
  });
  dlgQrExport.addEventListener('close', () => {
    clearInterval(qrTimer);
    qrTimer = null;
    $('#qrView').innerHTML = '';
  });
  $('#qrExportBtn').addEventListener('click', openQrExport);
}
