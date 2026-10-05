// QR 形式: SP1.<セッションID>.<番号>.<総数>.<データ>  （データ = 圧縮したコンパクトJSONをbase64url化したもの）
import { isoDay, isoOfDay } from './dates.js';
import { earnedOf } from './money.js';
import { APP_ID, SCHEMA, isNum } from './schema.js';

export const QR_CHUNK = 380; // 1枚あたりの文字数（小さいほど読み取りやすい）
export const QR_MAX_CHUNKS = 200;
export const QR_RE = /^SP1\.([0-9a-z]{4,8})\.(\d{1,3})\.(\d{1,3})\.([A-Za-z0-9_-]+)$/;
const hasCompression =
  typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

export function toB64u(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function fromB64u(str) {
  const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function runStream(stream, bytes) {
  const w = stream.writable.getWriter();
  w.write(bytes).catch(() => {});
  w.close().catch(() => {});
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

const secOf = (iso) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.floor(t / 1000) : 0;
};

// 状態 → 短い配列形式。日付は日数の差分、入力時刻とIDは省く（読み込み時に順序を保って振り直す）
export function toCompact(s) {
  const g = s.goal;
  const byDate = (a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : a.at < b.at ? -1 : a.at > b.at ? 1 : 0;
  let prev = 0;
  const rows = [...s.shifts].sort(byDate).map((x) => {
    const d = isoDay(x.date);
    const row = [d - prev, x.minutes, x.wage];
    prev = d;
    if (x.earned !== earnedOf(x.minutes, x.wage)) row.push(x.earned);
    return row;
  });
  prev = 0;
  const adj = [...s.adjustments].sort(byDate).map((x) => {
    const d = isoDay(x.date);
    const row = [d - prev, x.delta];
    prev = d;
    return row;
  });
  return {
    v: 1,
    g: [
      g.baseSavings,
      g.target,
      isoDay(g.deadline),
      g.hourlyWage,
      g.closingDay,
      g.payDay,
      secOf(g.createdAt),
    ],
    s: rows,
    a: adj,
  };
}
export function fromCompact(c) {
  const bad = () => {
    throw new Error('QRのデータが正しくありません。');
  };
  if (c?.v !== 1 || !Array.isArray(c.g) || !Array.isArray(c.s) || !Array.isArray(c.a)) bad();
  const [baseSavings, target, deadlineDay, hourlyWage, closingDay, payDay, created] = c.g;
  const dayOk = (n) => Number.isInteger(n) && n > 0 && n < 100000;
  if (!dayOk(deadlineDay)) bad();
  const baseAt = (isNum(created) && created > 0 ? created : 1577836800) * 1000;
  let prev = 0;
  const shifts = c.s.map((r, i) => {
    if (!Array.isArray(r)) bad();
    prev += r[0];
    if (!dayOk(prev)) bad();
    return {
      date: isoOfDay(prev),
      minutes: r[1],
      wage: r[2],
      earned: isNum(r[3]) ? r[3] : earnedOf(r[1], r[2]),
      at: new Date(baseAt + i * 1000).toISOString(),
    };
  });
  prev = 0;
  const adjustments = c.a.map((r, i) => {
    if (!Array.isArray(r)) bad();
    prev += r[0];
    if (!dayOk(prev)) bad();
    return {
      date: isoOfDay(prev),
      delta: r[1],
      at: new Date(baseAt + (500000 + i) * 1000).toISOString(),
    };
  });
  return {
    app: APP_ID,
    schemaVersion: SCHEMA,
    goal: {
      baseSavings,
      target,
      deadline: isoOfDay(deadlineDay),
      hourlyWage,
      closingDay,
      payDay,
      createdAt: isNum(created) && created > 0 ? new Date(created * 1000).toISOString() : '',
    },
    shifts,
    adjustments,
  };
}

export async function encodePayload(s) {
  const json = new TextEncoder().encode(JSON.stringify(toCompact(s)));
  if (hasCompression) return 'z' + toB64u(await runStream(new CompressionStream('deflate'), json));
  return 'j' + toB64u(json);
}
export async function decodePayload(p) {
  let bytes;
  try {
    const body = fromB64u(p.slice(1));
    if (p[0] === 'j') bytes = body;
    else if (p[0] === 'z') {
      if (!hasCompression)
        throw new Error('このブラウザは、圧縮されたQRデータの展開に対応していません。');
      bytes = await runStream(new DecompressionStream('deflate'), body);
    } else throw new Error('QRのデータ形式が正しくありません。');
  } catch (e) {
    throw new Error(
      /^(このブラウザ|QRのデータ形式)/.test(e.message)
        ? e.message
        : 'QRのデータを展開できませんでした。',
    );
  }
  let obj;
  try {
    obj = JSON.parse(new TextDecoder().decode(bytes));
  } catch (_) {
    throw new Error('QRのデータを読み取れませんでした。');
  }
  return fromCompact(obj);
}
export function makeChunks(payload) {
  const total = Math.ceil(payload.length / QR_CHUNK);
  const sid = Math.random().toString(36).slice(2, 8).padEnd(6, '0');
  const out = [];
  for (let i = 0; i < total; i++)
    out.push(`SP1.${sid}.${i + 1}.${total}.${payload.slice(i * QR_CHUNK, (i + 1) * QR_CHUNK)}`);
  return out;
}
