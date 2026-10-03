import { test, expect } from 'vitest';
import { dayNum, isoOfDay } from '../../src/core/dates.js';
import { money } from '../../src/core/money.js';
import { compute } from '../../src/core/compute.js';
import { fmtH } from '../../src/core/format.js';
import sample from '../fixtures/sample-state.json';

const T = { y: 2026, m: 10, d: 3, dow: 6 }; // 2026-10-03 (土)
const TODAY = dayNum(2026, 10, 3);
const base = (goal = {}, shifts = []) => ({
  goal: {
    baseSavings: 50000,
    target: 300000,
    deadline: '2027-03-31',
    hourlyWage: 1000,
    closingDay: 31,
    payDay: 25,
    ...goal,
  },
  shifts,
  adjustments: [],
});
const sh = (date, minutes, wage = 1000) => ({
  date,
  minutes,
  wage,
  earned: Math.round((minutes * wage) / 60),
});

test('基準: 149日・250時間・今週3.4・今月48.7・1日1.7', () => {
  const c = compute(base(), T);
  expect(isoOfDay(c.lastWork)).toBe('2027-02-28');
  expect(c.daysLeft).toBe(149);
  expect(c.remainingHours).toBe(250);
  expect(c.week.days).toBe(2);
  expect(isoOfDay(c.week.end)).toBe('2026-10-04');
  expect(fmtH(c.week.hours)).toBe('3.4');
  expect(c.month.days).toBe(29);
  expect(fmtH(c.month.hours)).toBe('48.7');
  expect(fmtH(c.perDay)).toBe('1.7');
});

test('目標日 2027-03-20 → 最終勤務日 2027-01-31', () => {
  expect(isoOfDay(compute(base({ deadline: '2027-03-20' }), T).lastWork)).toBe('2027-01-31');
});

test('今日に300分 → 入金待ち5,000、起点は明日（148日・245時間）', () => {
  const s = base({}, [sh('2026-10-03', 300)]);
  expect(money(s, TODAY)).toEqual({
    cash: 50000,
    pending: 5000,
    pendingCounted: 5000,
    nextPay: dayNum(2026, 11, 25),
  });
  const c = compute(s, T);
  expect(c.daysLeft).toBe(148);
  expect(c.remainingHours).toBe(245);
});

test('8/20 と 9/10 に600分 → 貯金60,000、9月分は10/25まで入金待ち', () => {
  const m = money(base({}, [sh('2026-08-20', 600), sh('2026-09-10', 600)]), TODAY);
  expect(m.cash).toBe(60000);
  expect(m.pending).toBe(10000);
  expect(isoOfDay(m.nextPay)).toBe('2026-10-25');
});

test('15日締め・5日払い', () => {
  expect(
    isoOfDay(money(base({ closingDay: 15, payDay: 5 }, [sh('2026-10-03', 60)]), TODAY).nextPay),
  ).toBe('2026-11-05');
  expect(money(base({ closingDay: 15, payDay: 5 }, [sh('2026-08-10', 60)]), TODAY).cash).toBe(
    51000,
  );
});

test('期限切れ: 目標日2026-10-20・目標80,000・10/3に600分', () => {
  const c = compute(base({ deadline: '2026-10-20', target: 80000 }, [sh('2026-10-03', 600)]), T);
  expect(c.expired).toBe(true);
  expect(c.achieved).toBe(false);
  expect(isoOfDay(c.lastWork)).toBe('2026-08-31');
  expect(c.lateEarned).toBe(10000);
  expect(c.remaining).toBe(30000);
  expect(c.week).toBeUndefined();
});

test('入金待ちで達成見込み: 目標55,000・10/3に300分', () => {
  const c = compute(base({ target: 55000 }, [sh('2026-10-03', 300)]), T);
  expect(c.achieved).toBe(true);
  expect(c.cashReached).toBe(false);
});

test('sample-state.json の数値（golden と同じ）', () => {
  const m = money(sample, TODAY);
  expect(m.cash).toBe(48600);
  expect(m.pending).toBe(23050);
  expect(isoOfDay(m.nextPay)).toBe('2026-10-25');
  const c = compute(sample, T);
  expect(c.daysLeft).toBe(149);
  expect([c.week.hours, c.month.hours, c.remainingHours, c.perDay].map(fmtH)).toEqual([
    '2.6',
    '37.1',
    '190.3',
    '1.3',
  ]);
});
