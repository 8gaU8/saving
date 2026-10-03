import { test, expect } from 'vitest';
import { yen, fmtH, fmtHM, fmtDay, fmtISO } from '../../src/core/format.js';
import { dayNum } from '../../src/core/dates.js';

test('§8.1 フォーマット', () => {
  expect(fmtH(3.36)).toBe('3.4');
  expect(fmtH(100)).toBe('100');
  expect(fmtH(0)).toBe('0');
  expect(fmtH(2.0000000001)).toBe('2'); // 1e-9 の誤差は切り上げない
  expect(fmtHM(330)).toBe('5時間30分');
  expect(fmtHM(60)).toBe('1時間');
  expect(fmtHM(45)).toBe('45分');
  expect(yen(-8000)).toBe('−¥8,000');
  expect(yen(48600)).toBe('¥48,600');
});

test('日付の表示', () => {
  expect(fmtDay(dayNum(2027, 2, 28), true)).toBe('2027年2月28日');
  expect(fmtDay(dayNum(2026, 10, 4))).toBe('10月4日');
  expect(fmtISO('2026-10-02', 2026)).toBe('10月2日（金）');
  expect(fmtISO('2027-01-02', 2026)).toBe('2027年1月2日（土）');
});
