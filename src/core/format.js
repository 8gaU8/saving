// 表示用フォーマット
import { partsOfDay, isoDay } from './dates.js';

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

export const yen = (n) => (n < 0 ? '−' : '') + '¥' + Math.abs(Math.round(n)).toLocaleString('ja-JP');
export const ceil1 = (h) => Math.ceil(h * 10 - 1e-9) / 10;
export const fmtH = (h) => { const v = ceil1(h); return Number.isInteger(v) ? String(v) : v.toFixed(1); };
export const fmtHM = (min) => {
  const h = Math.floor(min / 60), m = min % 60;
  if (h && m) return `${h}時間${m}分`;
  if (h) return `${h}時間`;
  return `${m}分`;
};
export const fmtDay = (n, withYear) => { const p = partsOfDay(n); return `${withYear ? p.y + '年' : ''}${p.m}月${p.d}日`; };
// thisYear と違う年のときだけ年を付ける
export const fmtISO = (s, thisYear) => {
  const p = partsOfDay(isoDay(s));
  return `${p.y !== thisYear ? p.y + '年' : ''}${p.m}月${p.d}日（${WEEKDAYS[p.dow]}）`;
};
