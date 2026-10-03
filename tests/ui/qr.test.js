// handoff/reference-tests/qr-roundtrip.reference.cjs の移植。
// 書き出した SVG をラスタライズして本物の jsqr で読み、読み込み側はカメラと jsqr をモックして文字列を順に渡す
import { test, expect, vi } from 'vitest';
import { boot, txt } from '../helpers/boot.js';

const q = vi.hoisted(() => ({ queue: [] }));
vi.mock('jsqr', () => ({ default: () => (q.queue.length ? { data: q.queue.shift() } : null) }));
const { default: realJsQR } = await vi.importActual('jsqr');

vi.setConfig({ testTimeout: 15000 });

const KEY = 'savings-pace:v1';
const tick = () => new Promise((r) => setTimeout(r, 0));
const waitFor = (fn) => vi.waitFor(fn, { timeout: 10000, interval: 20 });

// 140件の勤務（約7か月）、修正2件、導出と違う earned 1件
const shifts = [];
for (let i = 0; i < 140; i++) {
  const d = new Date(2026, 2, 1);
  d.setDate(d.getDate() + Math.floor(i * 1.5));
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const minutes = 180 + ((i * 37) % 300);
  const wage = i < 70 ? 1100 : 1150;
  shifts.push({
    id: 'id' + i,
    date,
    minutes,
    wage,
    earned: Math.round((minutes * wage) / 60),
    at: new Date(Date.UTC(2026, 2, 1, 11, 0, i)).toISOString(),
  });
}
shifts[10].earned += 7;
shifts.push({
  id: 'dup1',
  date: '2026-09-20',
  minutes: 120,
  wage: 1150,
  earned: 2300,
  at: '2026-09-20T10:00:00.000Z',
});
shifts.push({
  id: 'dup2',
  date: '2026-09-20',
  minutes: 90,
  wage: 1150,
  earned: 1725,
  at: '2026-09-20T11:00:00.000Z',
});
const orig = {
  app: 'savings-pace',
  schemaVersion: 1,
  goal: {
    baseSavings: 123456,
    target: 600000,
    deadline: '2027-03-31',
    hourlyWage: 1150.5,
    closingDay: 31,
    payDay: 25,
    createdAt: '2026-02-20T01:02:03.000Z',
  },
  shifts,
  adjustments: [
    { id: 'a1', date: '2026-05-05', delta: -15000, at: '2026-05-05T09:00:00.000Z' },
    { id: 'a2', date: '2026-08-01', delta: 4200, at: '2026-08-01T09:00:00.000Z' },
  ],
};
const tiny = {
  app: 'savings-pace',
  schemaVersion: 1,
  goal: {
    baseSavings: 0,
    target: 1000,
    deadline: '2027-01-01',
    hourlyWage: 1000,
    closingDay: 31,
    payDay: 25,
    createdAt: '',
  },
  shifts: [],
  adjustments: [],
};

const reducedMotion = (w) => {
  w.matchMedia = () => ({ matches: true });
};
function camera(w, getUserMedia) {
  reducedMotion(w);
  w.__camStopped = 0;
  Object.defineProperty(w.navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia:
        getUserMedia ||
        (async () => ({
          getTracks: () => [
            {
              stop() {
                w.__camStopped++;
              },
            },
          ],
        })),
    },
  });
  w.HTMLMediaElement.prototype.play = () => Promise.resolve();
  w.HTMLMediaElement.prototype.pause = () => {};
  Object.defineProperty(w.HTMLMediaElement.prototype, 'readyState', { get: () => 4 });
  Object.defineProperty(w.HTMLVideoElement.prototype, 'videoWidth', { get: () => 640 });
  Object.defineProperty(w.HTMLVideoElement.prototype, 'videoHeight', { get: () => 480 });
  w.HTMLCanvasElement.prototype.getContext = () => ({
    drawImage() {},
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
  });
}

// 表示中の QR（SVG）をラスタライズして本物の jsqr で読む
function readSvg(w) {
  const svg = w.document.querySelector('#qrView svg');
  const size = +svg.getAttribute('viewBox').split(' ')[2];
  const scale = 6,
    W = size * scale;
  const px = new Uint8ClampedArray(W * W * 4).fill(255);
  for (const m of svg
    .querySelector('path')
    .getAttribute('d')
    .matchAll(/M(\d+) (\d+)h(\d+)v1/g)) {
    const x0 = +m[1],
      y = +m[2],
      len = +m[3];
    for (let yy = y * scale; yy < (y + 1) * scale; yy++)
      for (let xx = x0 * scale; xx < (x0 + len) * scale; xx++) {
        const o = (yy * W + xx) * 4;
        px[o] = px[o + 1] = px[o + 2] = 0;
      }
  }
  const code = realJsQR(px, W, W);
  return code?.data;
}

const strip = (s) => ({
  goal: s.goal,
  shifts: s.shifts
    .map(({ date, minutes, wage, earned }) => ({ date, minutes, wage, earned }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.minutes - b.minutes)),
  adjustments: s.adjustments.map(({ date, delta }) => ({ date, delta })),
});
const screen = (w) =>
  ['#savingsAmount', '#pendingLine', '#needBody', '#historyList'].map((s) => txt(w, s));

const decoded = [];
let exportedScreen;

test('QR 書き出し: 全枚が本物のデコーダで読め、ヘッダとセッション ID が揃う', async () => {
  const w = await boot(orig, undefined, reducedMotion);
  const $ = (s) => w.document.querySelector(s);
  $('#openSettings').click();
  $('#qrExportBtn').click();
  await waitFor(() => expect($('#dlgQrExport').open).toBe(true));
  expect($('#dlgSettings').open).toBe(false);
  const total = +/^1 \/ (\d+)$/.exec(txt(w, '#qrCount'))[1];
  expect(total).toBeGreaterThan(1);
  expect($('#qrControls').hidden).toBe(false);
  expect(txt(w, '#qrPlay')).toBe('再生'); // reduced motion では自動再生しない
  expect(txt(w, '#qrHint')).toBe(
    `読み込む端末で「QRで読み込み」を開き、カメラを向けてください。QRは全${total}枚で、自動で切り替わります。すべて読み取れるまで、この画面を開いたままにしてください。`,
  );
  for (let i = 0; i < total; i++) {
    expect($('#qrView').getAttribute('aria-label')).toBe(
      `データのQRコード（${i + 1}枚目、全${total}枚）`,
    );
    decoded.push(readSvg(w));
    if (i < total - 1) $('#qrNext').click();
  }
  expect(decoded.every(Boolean)).toBe(true);
  expect(decoded.every((t) => /^SP1\.[0-9a-z]{6}\.\d+\.\d+\./.test(t))).toBe(true);
  expect(decoded.map((t) => t.split('.')[2])).toEqual(
    Array.from({ length: total }, (_, i) => String(i + 1)),
  );
  expect(new Set(decoded.map((t) => t.split('.')[1])).size).toBe(1);
  $('#qrNext').click();
  expect(txt(w, '#qrCount')).toBe(`1 / ${total}`);
  $('#qrPrev').click();
  expect(txt(w, '#qrCount')).toBe(`${total} / ${total}`);
  exportedScreen = screen(w);
  $('#dlgQrExport [data-close]').click();
  expect($('#qrView').innerHTML).toBe('');
});

test('QR 書き出し: 自動再生（1.6秒ごと）と一時停止', async () => {
  vi.useFakeTimers({
    now: new Date(2026, 9, 3, 12),
    toFake: ['Date', 'setInterval', 'clearInterval'],
  });
  const w = await boot(orig);
  vi.useFakeTimers({
    now: new Date(2026, 9, 3, 12),
    toFake: ['Date', 'setInterval', 'clearInterval'],
  });
  const $ = (s) => w.document.querySelector(s);
  $('#openSettings').click();
  $('#qrExportBtn').click();
  await waitFor(() => expect($('#dlgQrExport').open).toBe(true));
  expect(txt(w, '#qrPlay')).toBe('一時停止');
  const total = decoded.length;
  const at = (n) => new RegExp(`^${n} / ${total}$`);
  vi.advanceTimersByTime(1600);
  expect(txt(w, '#qrCount')).toMatch(at(2));
  $('#qrPlay').click();
  expect(txt(w, '#qrPlay')).toBe('再生');
  vi.advanceTimersByTime(5000);
  expect(txt(w, '#qrCount')).toMatch(at(2));
  $('#qrPlay').click();
  vi.advanceTimersByTime(1600);
  expect(txt(w, '#qrCount')).toMatch(at((2 % total) + 1)); // 最後の次は1枚目に戻る
  $('#qrNext').click(); // 手動操作で停止
  expect(txt(w, '#qrPlay')).toBe('再生');
});

test('QR 読み込み（カメラ）: 順不同・重複・無関係な QR が混ざっても復元できる', async () => {
  const shuffled = [...decoded].reverse();
  q.queue = [
    'https://example.com/not-ours',
    ...shuffled.slice(0, 2),
    shuffled[0],
    ...shuffled.slice(2),
  ];
  const w = await boot(null, undefined, camera);
  const $ = (s) => w.document.querySelector(s);
  expect($('#setupView').hidden).toBe(false);
  $('#setupQr').click();
  expect($('#dlgQrImport').open).toBe(true);
  await waitFor(() => expect($('#mainView').hidden).toBe(false));
  expect($('#dlgQrImport').open).toBe(false);
  expect(w.__camStopped).toBeGreaterThanOrEqual(1);
  expect(txt(w, '#toast')).toBe('インポートしました');
  const s = JSON.parse(w.localStorage.getItem(KEY));
  expect(strip(s)).toEqual(strip(orig));
  expect(screen(w)).toEqual(exportedScreen);
});

test('QR 読み込み: 進捗表示（ドットと枚数）', async () => {
  q.queue = [decoded[1]];
  const w = await boot(null, undefined, camera);
  const $ = (s) => w.document.querySelector(s);
  $('#setupQr').click();
  await waitFor(() => expect(txt(w, '#qrStatus')).toBe(`読み取り中… 1 / ${decoded.length}`));
  const dots = [...w.document.querySelectorAll('#qrDots i')].map((i) => i.className);
  expect(dots).toHaveLength(decoded.length);
  expect(dots.filter((c) => c === 'on')).toHaveLength(1);
  expect(dots[1]).toBe('on');
  $('#dlgQrImport [data-close]').click();
  expect(w.__camStopped).toBe(1);
});

test('QR 読み込み: 壊れたデータはエラーを残したままカメラ再開、状態は変えない', async () => {
  q.queue = decoded.map((t, i) => (i === 1 ? t.slice(0, -6) + 'AAAAAA' : t));
  const w = await boot(null, undefined, camera);
  const $ = (s) => w.document.querySelector(s);
  $('#setupQr').click();
  await waitFor(() => expect($('#qrStatus').classList.contains('err')).toBe(true));
  expect(txt(w, '#qrStatus')).toMatch(/もう一度読み取ってください。$/);
  expect($('#setupView').hidden).toBe(false);
  expect($('#dlgQrImport').open).toBe(true);
  expect(w.document.querySelector('#qrDots').innerHTML).toBe('');
  await tick();
  await tick();
  expect($('#qrStatus').classList.contains('err')).toBe(true); // カメラ再開後もメッセージを残す
  $('#dlgQrImport [data-close]').click(); // 再開したカメラのループを止める（キューを共有しているため）
});

test('QR 読み込み: 既存データがあれば置き換え確認', async () => {
  q.queue = [...decoded];
  const w = await boot({ ...orig, goal: { ...orig.goal, target: 999999 } }, undefined, camera);
  const $ = (s) => w.document.querySelector(s);
  $('#openSettings').click();
  $('#qrImportBtn').click();
  expect($('#dlgSettings').open).toBe(false);
  await waitFor(() => expect($('#dlgConfirm').open).toBe(true));
  expect($('#dlgQrImport').open).toBe(false); // トーストより先にダイアログを閉じる
  $('#cfOk').click();
  await tick();
  expect(JSON.parse(w.localStorage.getItem(KEY)).goal.target).toBe(600000);
});

test('QR 書き出し: 小さいデータは1枚で、切り替えボタンなし', async () => {
  const w = await boot(tiny, undefined, reducedMotion);
  const $ = (s) => w.document.querySelector(s);
  $('#openSettings').click();
  $('#qrExportBtn').click();
  await waitFor(() => expect($('#dlgQrExport').open).toBe(true));
  expect($('#qrControls').hidden).toBe(true);
  expect(txt(w, '#qrCount')).toBe('1枚だけです');
  expect(txt(w, '#qrHint')).toBe(
    '読み込む端末で「QRで読み込み」を開き、このQRにカメラを向けてください。',
  );
  expect(readSvg(w)).toMatch(/^SP1\.[0-9a-z]{6}\.1\.1\./);
});

test('QR 読み込み: カメラが使えない / 許可されない', async () => {
  let w = await boot(null, undefined, reducedMotion);
  w.document.querySelector('#setupQr').click();
  await tick();
  expect(txt(w, '#qrStatus')).toBe(
    'このブラウザではカメラを使えません。「画像から読み込む」をお使いください。',
  );
  expect(w.document.querySelector('#qrStatus').classList.contains('err')).toBe(true);

  w = await boot(null, undefined, (w) =>
    camera(w, async () => {
      throw Object.assign(new Error('x'), { name: 'NotAllowedError' });
    }),
  );
  w.document.querySelector('#setupQr').click();
  await waitFor(() =>
    expect(txt(w, '#qrStatus')).toBe(
      'カメラの使用が許可されていません。ブラウザの設定で許可するか、「画像から読み込む」をお使いください。',
    ),
  );

  w = await boot(null, undefined, (w) =>
    camera(w, async () => {
      throw new Error('busy');
    }),
  );
  w.document.querySelector('#setupQr').click();
  await waitFor(() =>
    expect(txt(w, '#qrStatus')).toBe(
      'カメラを起動できませんでした。「画像から読み込む」をお使いください。',
    ),
  );
});

test('QR 読み込み（画像）: 複数選択、読めない画像、残り枚数', async () => {
  const w = await boot(null, undefined, (w) => {
    camera(w, async () => {
      throw new Error('no camera');
    });
    w.Image = class {
      set src(_) {
        setTimeout(() => this.onload());
      }
      get naturalWidth() {
        return 3000;
      }
      get naturalHeight() {
        return 1500;
      }
    };
  });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const $ = (s) => w.document.querySelector(s);
  const pick = (n) => {
    Object.defineProperty($('#qrImageInput'), 'files', {
      configurable: true,
      value: Array.from({ length: n }, () => ({})),
    });
    $('#qrImageInput').dispatchEvent(new w.Event('change'));
  };
  $('#setupQr').click();
  // 1枚目: 3サイズとも読めない → 2枚目: 読める
  q.queue = [];
  const real = q.queue;
  pick(1);
  await waitFor(() =>
    expect(txt(w, '#qrStatus')).toBe(
      '画像からQRコードを読み取れませんでした。QR全体が写っているか確認してください。',
    ),
  );
  expect(real).toHaveLength(0);
  q.queue = [decoded[0]];
  pick(1);
  await waitFor(() =>
    expect(txt(w, '#qrStatus')).toBe(`1枚のQRを読み取りました。あと${decoded.length - 1}枚です。`),
  );
  q.queue = decoded.slice(1);
  pick(decoded.length - 1);
  await waitFor(() => expect($('#mainView').hidden).toBe(false));
  expect($('#dlgQrImport').open).toBe(false);
  vi.restoreAllMocks();
});
