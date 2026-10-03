import { test, expect } from 'vitest';
import {
  dayNum,
  isoDay,
  isoOfDay,
  parseISO,
  partsOfDay,
  dim,
  addMonth,
  monthEndDay,
} from '../../src/core/dates.js';
import { payDayOf, lastCountedWorkDay } from '../../src/core/payCycle.js';

const g = (closingDay, payDay) => ({ closingDay, payDay });

test.each([
  ['2026-10-03', 31, 25, '2026-11-25'],
  ['2026-10-31', 31, 25, '2026-11-25'],
  ['2026-01-31', 31, 25, '2026-02-25'],
  ['2026-12-15', 31, 25, '2027-01-25'],
  ['2026-10-15', 15, 5, '2026-11-05'],
  ['2026-10-16', 15, 5, '2026-12-05'],
  ['2026-08-10', 15, 5, '2026-09-05'],
  ['2026-01-31', 31, 31, '2026-02-28'],
  ['2026-03-31', 31, 31, '2026-04-30'],
])('payDayOf(%s, %i/%i) = %s', (work, c, p, pay) => {
  expect(isoOfDay(payDayOf(work, g(c, p)))).toBe(pay);
});

test.each([
  ['2027-03-31', 31, 25, '2027-02-28'],
  ['2027-03-25', 31, 25, '2027-02-28'],
  ['2027-03-20', 31, 25, '2027-01-31'],
  ['2026-10-20', 31, 25, '2026-08-31'],
  ['2027-03-04', 15, 5, '2027-01-15'],
  ['2027-03-05', 15, 5, '2027-02-15'],
])('lastCountedWorkDay(%s, %i/%i) = %s', (deadline, c, p, last) => {
  expect(isoOfDay(lastCountedWorkDay(isoDay(deadline), g(c, p)))).toBe(last);
});

test('dates の基本', () => {
  expect(parseISO('2026-02-29')).toBeNull();
  expect(parseISO('2028-02-29')).toEqual({ y: 2028, m: 2, d: 29 });
  expect(parseISO('2026-1-01')).toBeNull();
  expect(isoDay('x')).toBeNull();
  expect(partsOfDay(dayNum(2026, 10, 3))).toEqual({ y: 2026, m: 10, d: 3, dow: 6 });
  expect(dim(2026, 2)).toBe(28);
  expect(addMonth(2026, 12, 1)).toEqual({ y: 2027, m: 1 });
  expect(addMonth(2026, 1, -3)).toEqual({ y: 2025, m: 10 });
  expect(isoOfDay(monthEndDay(2026, 10))).toBe('2026-10-31');
});
