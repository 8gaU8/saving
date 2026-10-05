import { test, expect } from 'vitest';
import { readNum, goalError, formMinutes, formTimes } from '../../src/core/validation.js';
import { dayNum } from '../../src/core/dates.js';

const TODAY = dayNum(2026, 10, 3);

test('readNum', () => {
  expect(readNum(' 12.5 ')).toBe(12.5);
  expect(readNum('')).toBeNaN();
  expect(readNum('abc')).toBeNaN();
});

test.each([
  ['', '', { error: '勤務時間を入力してください。' }],
  ['1.5', '', { min: 90 }],
  ['', '45', { min: 45 }],
  ['5', '30', { min: 330 }],
  ['24', '0', { min: 1440 }],
  ['24', '1', { error: '勤務時間は24時間以内で入力してください。' }],
  ['1', '60', { error: '分は0〜59で入力してください。' }],
  ['-1', '0', { error: '勤務時間は0以上で入力してください。' }],
  ['x', '0', { error: '勤務時間は数字で入力してください。' }],
  ['0.004', '0', { error: '勤務時間を入力してください。' }],
])('formMinutes(%j, %j)', (h, m, out) => {
  expect(formMinutes(h, m)).toEqual(out);
});

test.each([
  ['', '', null],
  ['9:00', '17:30', { min: 510 }],
  ['13:52', '14:07', { min: 15 }],
  ['00:00', '23:59', { min: 1439 }],
  ['9:00', '', { error: '開始・終了時刻は 13:52 のように入力してください。' }],
  ['9', '17:00', { error: '開始・終了時刻は 13:52 のように入力してください。' }],
  ['9:60', '17:00', { error: '開始・終了時刻は 13:52 のように入力してください。' }],
  ['24:00', '17:00', { error: '開始・終了時刻は 13:52 のように入力してください。' }],
  ['9：00', '17:00', { error: '開始・終了時刻は 13:52 のように入力してください。' }],
  ['17:00', '17:00', { error: '終了時刻は開始時刻より後にしてください。' }],
  ['22:00', '02:00', { error: '終了時刻は開始時刻より後にしてください。' }],
])('formTimes(%j, %j)', (s, e, out) => {
  expect(formTimes(s, e)).toEqual(out);
});

const ok = { target: 300000, deadline: '2027-03-31', wage: 1200, closing: 31, payDay: 25 };
test.each([
  [{}, true, ''],
  [{ target: 0 }, true, '目標金額は1円以上の数字で入力してください。'],
  [{ deadline: '' }, true, '目標を達成する日を選んでください。'],
  [{ deadline: '2026-10-02' }, true, '目標日は今日以降の日付にしてください。'],
  [{ deadline: '2026-10-02' }, false, ''],
  [{ deadline: '2026-10-03' }, true, ''],
  [{ wage: NaN }, true, '時給は1円以上の数字で入力してください。'],
  [{ closing: 0 }, true, '締め日は1〜31の整数で入力してください（月末は31）。'],
  [{ payDay: 31.5 }, true, '支払日は1〜31の整数で入力してください。'],
])('goalError(%j, %s)', (patch, check, msg) => {
  expect(goalError({ ...ok, ...patch }, check, TODAY)).toBe(msg);
});
