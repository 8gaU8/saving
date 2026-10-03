// 状態オブジェクト（schemaVersion 1）の検証と正規化。エラー文言は UI に表示される
import { parseISO } from './dates.js';
import { DEFAULT_CLOSING, DEFAULT_PAYDAY } from './payCycle.js';
import { earnedOf } from './money.js';

export const APP_ID = 'savings-pace';
export const SCHEMA = 1;
export const MAX_ROWS = 20000;

export const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
export const newId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

export function normalizeState(o) {
  const fail = (m) => { throw new Error(m); };
  if (!o || typeof o !== 'object' || Array.isArray(o)) fail('ファイルの形式が正しくありません。');
  if (o.app !== APP_ID) fail('このアプリで書き出したファイルではありません。');
  if (o.schemaVersion !== SCHEMA) fail('対応していないバージョンのファイルです。');
  const g = o.goal;
  if (!g || typeof g !== 'object') fail('目標のデータがありません。');
  if (!isNum(g.baseSavings) || g.baseSavings < 0) fail('貯金額のデータが正しくありません。');
  if (!isNum(g.target) || g.target <= 0) fail('目標金額のデータが正しくありません。');
  if (!parseISO(g.deadline)) fail('目標日のデータが正しくありません。');
  if (!isNum(g.hourlyWage) || g.hourlyWage <= 0) fail('時給のデータが正しくありません。');
  const validDay = (v) => Number.isInteger(v) && v >= 1 && v <= 31;
  const closingDay = g.closingDay === undefined ? DEFAULT_CLOSING : g.closingDay;
  const payDay = g.payDay === undefined ? DEFAULT_PAYDAY : g.payDay;
  if (!validDay(closingDay)) fail('締め日のデータが正しくありません。');
  if (!validDay(payDay)) fail('支払日のデータが正しくありません。');
  if (!Array.isArray(o.shifts)) fail('勤務履歴のデータが正しくありません。');
  const adjIn = o.adjustments === undefined ? [] : o.adjustments;
  if (!Array.isArray(adjIn)) fail('貯金額の修正履歴が正しくありません。');
  if (o.shifts.length > MAX_ROWS || adjIn.length > MAX_ROWS) fail('データが大きすぎます。');

  const used = new Set();
  const uid = (v) => {
    let id = typeof v === 'string' ? v.replace(/[^\w-]/g, '').slice(0, 64) : '';
    if (!id || used.has(id)) id = newId();
    used.add(id);
    return id;
  };
  const str = (v) => (typeof v === 'string' ? v.slice(0, 40) : '');

  const shifts = o.shifts.map((s, i) => {
    if (!s || typeof s !== 'object') fail(`勤務履歴の${i + 1}件目が正しくありません。`);
    if (!parseISO(s.date)) fail(`勤務履歴の${i + 1}件目の日付が正しくありません。`);
    if (!Number.isInteger(s.minutes) || s.minutes < 1 || s.minutes > 1440) fail(`勤務履歴の${i + 1}件目の勤務時間が正しくありません。`);
    const wage = isNum(s.wage) && s.wage >= 0 ? s.wage : g.hourlyWage;
    const earned = isNum(s.earned) ? Math.round(s.earned) : earnedOf(s.minutes, wage);
    return { id: uid(s.id), date: s.date, minutes: s.minutes, wage, earned, at: str(s.at) };
  });
  const adjustments = adjIn.map((a, i) => {
    if (!a || typeof a !== 'object' || !parseISO(a.date) || !isNum(a.delta)) fail(`貯金額の修正履歴の${i + 1}件目が正しくありません。`);
    return { id: uid(a.id), date: a.date, delta: Math.round(a.delta), at: str(a.at) };
  });

  return {
    app: APP_ID,
    schemaVersion: SCHEMA,
    goal: {
      baseSavings: Math.round(g.baseSavings),
      target: Math.round(g.target),
      deadline: g.deadline,
      hourlyWage: g.hourlyWage,
      closingDay,
      payDay,
      createdAt: str(g.createdAt)
    },
    shifts,
    adjustments
  };
}
