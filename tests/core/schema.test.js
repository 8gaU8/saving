import { test, expect } from 'vitest';
import { normalizeState } from '../../src/core/schema.js';
import sample from '../fixtures/sample-state.json';
import noPayCycle from '../fixtures/sample-state.no-paycycle.json';
import exported from '../fixtures/sample-export.json';

const clone = (o) => JSON.parse(JSON.stringify(o));

test('sample-state.json はそのまま通る', () => {
  expect(normalizeState(clone(sample))).toEqual(sample);
});

test('締め日・支払日のない旧形式は 31 / 25 になる', () => {
  expect(normalizeState(clone(noPayCycle))).toEqual(sample);
});

test('エクスポート形式は exportedAt が状態に残らない', () => {
  const s = normalizeState(clone(exported));
  expect(s).not.toHaveProperty('exportedAt');
  expect(s).toEqual(normalizeState(clone(sample)));
});

test('ID の正規化: 不正文字を除き、空・重複は新規発行', () => {
  const o = clone(sample);
  o.shifts[0].id = 'a b!c';
  o.shifts[1].id = 'abc';
  o.shifts[2].id = 123;
  o.adjustments[0].id = 'x'.repeat(100);
  const s = normalizeState(o);
  expect(s.shifts[0].id).toBe('abc');
  expect(s.shifts[1].id).not.toBe('abc');
  expect(s.shifts[2].id).toMatch(/^[\w-]+$/);
  expect(s.adjustments[0].id).toBe('x'.repeat(64));
});

test('earned・wage の補完と丸め', () => {
  const o = clone(sample);
  delete o.shifts[0].earned;
  o.shifts[0].wage = -1; // → goal.hourlyWage (1200)
  o.adjustments[0].delta = -7999.6;
  delete o.adjustments[0].at;
  const s = normalizeState(o);
  expect(s.shifts[0]).toMatchObject({ wage: 1200, earned: 7200 });
  expect(s.adjustments[0]).toMatchObject({ delta: -8000, at: '' });
});

const bad = (mut) => {
  const o = clone(sample);
  mut(o);
  return () => normalizeState(o);
};
test.each([
  ['ファイルの形式が正しくありません。', () => normalizeState([])],
  [
    'このアプリで書き出したファイルではありません。',
    bad((o) => {
      o.app = 'x';
    }),
  ],
  [
    '対応していないバージョンのファイルです。',
    bad((o) => {
      o.schemaVersion = 2;
    }),
  ],
  [
    '目標のデータがありません。',
    bad((o) => {
      delete o.goal;
    }),
  ],
  [
    '貯金額のデータが正しくありません。',
    bad((o) => {
      o.goal.baseSavings = -1;
    }),
  ],
  [
    '目標金額のデータが正しくありません。',
    bad((o) => {
      o.goal.target = 0;
    }),
  ],
  [
    '目標日のデータが正しくありません。',
    bad((o) => {
      o.goal.deadline = '2027-02-30';
    }),
  ],
  [
    '時給のデータが正しくありません。',
    bad((o) => {
      o.goal.hourlyWage = 0;
    }),
  ],
  [
    '締め日のデータが正しくありません。',
    bad((o) => {
      o.goal.closingDay = 32;
    }),
  ],
  [
    '支払日のデータが正しくありません。',
    bad((o) => {
      o.goal.payDay = 1.5;
    }),
  ],
  [
    '勤務履歴のデータが正しくありません。',
    bad((o) => {
      o.shifts = {};
    }),
  ],
  [
    '貯金額の修正履歴が正しくありません。',
    bad((o) => {
      o.adjustments = null;
    }),
  ],
  [
    'データが大きすぎます。',
    bad((o) => {
      o.shifts = new Array(20001).fill(o.shifts[0]);
    }),
  ],
  [
    '勤務履歴の2件目が正しくありません。',
    bad((o) => {
      o.shifts[1] = null;
    }),
  ],
  [
    '勤務履歴の2件目の日付が正しくありません。',
    bad((o) => {
      o.shifts[1].date = '2026/09/10';
    }),
  ],
  [
    '勤務履歴の2件目の勤務時間が正しくありません。',
    bad((o) => {
      o.shifts[1].minutes = 1441;
    }),
  ],
  [
    '貯金額の修正履歴の1件目が正しくありません。',
    bad((o) => {
      o.adjustments[0].delta = '1';
    }),
  ],
])('%s', (msg, fn) => {
  expect(fn).toThrow(new Error(msg));
});
