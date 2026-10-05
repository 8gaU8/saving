// handoff/reference-tests/pay-cycle.reference.cjs の移植
import { test, expect } from 'vitest';
import { boot, txt } from '../helpers/boot.js';

const base = (goal, shifts = [], adjustments = []) => ({
  app: 'savings-pace',
  schemaVersion: 1,
  goal: {
    baseSavings: 50000,
    target: 300000,
    deadline: '2027-03-31',
    hourlyWage: 1000,
    closingDay: 31,
    payDay: 25,
    createdAt: '',
    ...goal,
  },
  shifts,
  adjustments,
});
const sh = (date, minutes, wage = 1000) => ({
  id: 's' + date,
  date,
  minutes,
  wage,
  earned: Math.round((minutes * wage) / 60),
  at: date,
});

test('目標日 3/31 → 2/28 の勤務分まで、149日、今週3.4・今月48.7', async () => {
  const need = txt(await boot(base({})), '#needBody');
  expect(need).toContain('2027年2月28日の勤務分まで');
  expect(need).toContain('あと149日');
  expect(need).toContain('今週3.4時間');
  expect(need).toContain('今月48.7時間');
  expect(need).toContain('目標日まで250時間');
  expect(need).toContain('1日あたり約1.7時間');
});

test('目標日 3/20 → 1/31 の勤務分まで', async () => {
  expect(txt(await boot(base({ deadline: '2027-03-20' })), '#needBody')).toContain(
    '2027年1月31日の勤務分まで',
  );
});

test('目標日が支払日当日(3/25)ならその回を含む', async () => {
  expect(txt(await boot(base({ deadline: '2027-03-25' })), '#needBody')).toContain(
    '2027年2月28日の勤務分まで',
  );
});

test('今日の勤務は入金待ち（11/25）、起点は明日', async () => {
  const w = await boot(base({}, [sh('2026-10-03', 300)]));
  expect(txt(w, '#savingsAmount')).toBe('¥50,000');
  expect(txt(w, '#pendingLine')).toContain('¥5,000');
  expect(txt(w, '#pendingLine')).toContain('11月25日');
  expect(txt(w, '#needBody')).toContain('あと148日');
  expect(txt(w, '#needBody')).toContain('目標日まで245時間');
  expect(txt(w, '#historyList')).toContain('11月25日に入金予定');
});

test('8月分は9/25入金済み、9月分は10/25まで入金待ち', async () => {
  const w = await boot(base({}, [sh('2026-08-20', 600), sh('2026-09-10', 600)]));
  expect(txt(w, '#savingsAmount')).toBe('¥60,000');
  expect(txt(w, '#pendingLine')).toContain('10月25日');
  expect(txt(w, '#historyList')).toContain('入金済み');
});

test('目標日に間に合わない入金待ちは計算外（期限切れ表示）', async () => {
  const need = txt(
    await boot(base({ deadline: '2026-10-20', target: 80000 }, [sh('2026-10-03', 600)])),
    '#needBody',
  );
  expect(need).toContain('目標日までに入金される勤務期間が残っていません。');
  expect(need).toContain('2026年8月31日までの勤務分');
  expect(need).toContain('目標日に間に合わない入金待ち（¥10,000）は、計算に含めていません。');
});

test('入金待ちを合わせると達成', async () => {
  expect(txt(await boot(base({ target: 55000 }, [sh('2026-10-03', 300)])), '#needBody')).toContain(
    '入金待ちを合わせると、目標金額に届きます。',
  );
});

test('15日締め・5日払い', async () => {
  let w = await boot(
    base({ closingDay: 15, payDay: 5 }, [sh('2026-10-03', 60), sh('2026-09-20', 60)]),
  );
  expect(txt(w, '#pendingLine')).toContain('11月5日');
  w = await boot(base({ closingDay: 15, payDay: 5 }, [sh('2026-08-10', 60)]));
  expect(txt(w, '#savingsAmount')).toBe('¥51,000');
});

test('初回設定の既定値 31/25 が保存される', async () => {
  const w = await boot(null);
  const $ = (s) => w.document.querySelector(s);
  expect($('#sClosing').value).toBe('31');
  expect($('#sPayDay').value).toBe('25');
  $('#sCurrent').value = '10000';
  $('#sTarget').value = '100000';
  $('#sWage').value = '1100';
  $('#sDeadline').value = '2027-01-31';
  $('#setupForm').dispatchEvent(new w.Event('submit', { cancelable: true, bubbles: true }));
  const st = JSON.parse(w.localStorage.getItem('savings-pace:v1'));
  expect(st.goal.closingDay).toBe(31);
  expect(st.goal.payDay).toBe(25);
  expect($('#mainView').hidden).toBe(false);
});

test('締め日・支払日のない旧形式も読み込める', async () => {
  const legacy = base({});
  delete legacy.goal.closingDay;
  delete legacy.goal.payDay;
  const w = await boot(legacy);
  expect(w.document.querySelector('#mainView').hidden).toBe(false);
  expect(txt(w, '#needBody')).toContain('あと149日');
});
