// 勤務フォーム・履歴・貯金額の修正・設定・JSON 入出力・ダイアログの操作
import { test, expect, vi } from 'vitest';
import { boot, txt } from '../helpers/boot.js';
import sample from '../fixtures/sample-state.json';
import exported from '../fixtures/sample-export.json';

const KEY = 'savings-pace:v1';
const tick = () => new Promise((r) => setTimeout(r, 0));
const saved = (w) => JSON.parse(w.localStorage.getItem(KEY));
const helpers = (w) => {
  const $ = (s) => w.document.querySelector(s);
  const set = (s, v) => {
    $(s).value = v;
    $(s).dispatchEvent(new w.Event('input', { bubbles: true }));
  };
  const submit = (s) =>
    $(s).dispatchEvent(new w.Event('submit', { cancelable: true, bubbles: true }));
  return { $, set, submit };
};

test('勤務を記録: プレビュー・保存・フォームのリセット', async () => {
  const w = await boot(sample);
  const { $, set, submit } = helpers(w);
  expect($('#shiftDate').value).toBe('2026-10-03');
  expect($('#shiftDate').max).toBe('2026-10-03');
  set('#shiftH', '2');
  set('#shiftM', '30');
  expect(txt(w, '#shiftPreview')).toBe('2時間30分 → +¥3,000');
  submit('#shiftForm');
  expect(txt(w, '#toast')).toBe('勤務を記録しました');
  const s = saved(w).shifts.at(-1);
  expect(s).toMatchObject({ date: '2026-10-03', minutes: 150, wage: 1200, earned: 3000 });
  expect($('#shiftH').value).toBe('');
  expect(txt(w, '#shiftPreview')).toBe('');
  expect(txt(w, '#historyList')).toMatch(/^10月3日（土）11月25日に入金予定 \+¥3,000 2時間30分/);
});

test('勤務フォームの検証', async () => {
  const w = await boot(sample);
  const { $, set, submit } = helpers(w);
  set('#shiftH', '1');
  $('#shiftDate').value = '2026-10-04';
  submit('#shiftForm');
  expect(txt(w, '#shiftError')).toBe('今日より先の日付は記録できません。');
  $('#shiftDate').value = '';
  submit('#shiftForm');
  expect(txt(w, '#shiftError')).toBe('日付を選んでください。');
  $('#shiftDate').value = '2026-10-01';
  set('#shiftM', '60');
  submit('#shiftForm');
  expect(txt(w, '#shiftError')).toBe('分は0〜59で入力してください。');
  expect(txt(w, '#shiftPreview')).toBe('');
  expect(saved(w).shifts).toHaveLength(6);
});

test('勤務を編集: 記録時の時給で再計算、キャンセルで戻る', async () => {
  const w = await boot(sample);
  const { $, set, submit } = helpers(w);
  const firstId = saved(w).shifts.find((s) => s.date === '2026-10-01' && s.minutes === 330).id;
  $(`#historyList button[data-act="edit"][data-id="${firstId}"]`).click();
  expect(txt(w, '#formTitle')).toBe('勤務を編集');
  expect(txt(w, '#shiftSubmit')).toBe('更新する');
  expect($('#shiftCancel').hidden).toBe(false);
  expect([$('#shiftDate').value, $('#shiftH').value, $('#shiftM').value]).toEqual([
    '2026-10-01',
    '5',
    '30',
  ]);
  expect(txt(w, '#shiftPreview')).toBe('5時間30分 → +¥6,050');
  set('#shiftH', '6');
  submit('#shiftForm');
  expect(txt(w, '#toast')).toBe('勤務を更新しました');
  expect(saved(w).shifts.find((s) => s.id === firstId)).toMatchObject({
    minutes: 390,
    wage: 1100,
    earned: 7150,
  });
  expect(txt(w, '#formTitle')).toBe('勤務を記録');
  expect($('#shiftCancel').hidden).toBe(true);

  $(`#historyList button[data-act="edit"][data-id="${firstId}"]`).click();
  $('#shiftCancel').click();
  expect(txt(w, '#formTitle')).toBe('勤務を記録');
  expect($('#shiftDate').value).toBe('2026-10-03');
});

test('勤務の削除: 確認ダイアログ（キャンセル / 削除）', async () => {
  const w = await boot(sample);
  const { $ } = helpers(w);
  const del = () => $('#historyList button[data-act="del"]');
  del().click();
  expect($('#dlgConfirm').open).toBe(true);
  expect(txt(w, '#cfTitle')).toBe('この勤務記録を削除しますか？');
  expect(txt(w, '#cfMsg')).toBe(
    '10月2日（金）・5時間（¥6,000）を削除すると、この金額が貯金額・入金待ちから外れます。',
  );
  expect($('#cfOk').className).toBe('btn danger-solid');
  expect(txt(w, '#cfOk')).toBe('削除する');
  $('#cfCancel').click();
  await tick();
  expect(saved(w).shifts).toHaveLength(6);
  del().click();
  $('#cfOk').click();
  await tick();
  expect(saved(w).shifts).toHaveLength(5);
  expect(txt(w, '#toast')).toBe('削除しました');
  expect(txt(w, '#pendingLine')).toBe('入金待ち ¥17,050（次の入金は10月25日）');
});

test('編集中の勤務を削除するとフォームもリセット', async () => {
  const w = await boot(sample);
  const { $ } = helpers(w);
  $('#historyList button[data-act="edit"]').click();
  $('#historyList button[data-act="del"]').click();
  $('#cfOk').click();
  await tick();
  expect(txt(w, '#formTitle')).toBe('勤務を記録');
});

test('貯金額の修正の取り消し', async () => {
  const w = await boot(sample);
  const { $ } = helpers(w);
  $('#historyList button[data-act="delAdj"]').click();
  expect(txt(w, '#cfMsg')).toBe(
    '9月15日（火）の貯金額の修正（−¥8,000）を取り消すと、貯金額が元に戻ります。',
  );
  $('#cfOk').click();
  await tick();
  expect(saved(w).adjustments).toHaveLength(0);
  expect(txt(w, '#savingsAmount')).toBe('¥56,600');
  expect(txt(w, '#toast')).toBe('取り消しました');
});

test('履歴は20件ずつ表示', async () => {
  const shifts = Array.from({ length: 25 }, (_, i) => ({
    id: 's' + i,
    date: `2026-09-${String(i + 1).padStart(2, '0')}`,
    minutes: 60,
    wage: 1000,
    earned: 1000,
    at: '',
  }));
  const w = await boot({ ...sample, shifts, adjustments: [] });
  const { $ } = helpers(w);
  expect(w.document.querySelectorAll('#historyList li')).toHaveLength(20);
  expect($('#moreBtn').hidden).toBe(false);
  $('#moreBtn').click();
  expect(w.document.querySelectorAll('#historyList li')).toHaveLength(25);
  expect($('#moreBtn').hidden).toBe(true);
});

test('記録がないときの履歴', async () => {
  const w = await boot({ ...sample, shifts: [], adjustments: [] });
  expect(txt(w, '#historyList')).toBe(
    'まだ記録がありません。勤務が終わったら、上のフォームに勤務時間を入力してください。',
  );
  expect(txt(w, '#workedStats')).toBe('今週 0分今月 0分');
});

test('貯金額を修正', async () => {
  const w = await boot(sample);
  const { $, submit } = helpers(w);
  $('#editSavings').click();
  expect($('#dlgSavings').open).toBe(true);
  expect($('#svInput').value).toBe('48600');
  $('#svInput').value = '-1';
  submit('#savingsForm');
  expect(txt(w, '#svError')).toBe('0以上の数字で入力してください。');
  $('#svInput').value = '48600';
  submit('#savingsForm');
  expect($('#dlgSavings').open).toBe(false);
  expect(saved(w).adjustments).toHaveLength(1);
  $('#editSavings').click();
  expect(txt(w, '#svError')).toBe('');
  $('#svInput').value = '50000.4';
  submit('#savingsForm');
  expect(saved(w).adjustments.at(-1)).toMatchObject({ date: '2026-10-03', delta: 1400 });
  expect(txt(w, '#savingsAmount')).toBe('¥50,000');
  expect(txt(w, '#toast')).toBe('貯金額を修正しました');
});

test('設定: 初期値・検証・保存', async () => {
  const w = await boot(sample);
  const { $, submit } = helpers(w);
  $('#openSettings').click();
  expect($('#dlgSettings').open).toBe(true);
  expect(
    ['#gTarget', '#gDeadline', '#gWage', '#gClosing', '#gPayDay'].map((s) => $(s).value),
  ).toEqual(['300000', '2027-03-31', '1200', '31', '25']);
  $('#gDeadline').value = '2026-10-01';
  submit('#goalForm');
  expect(txt(w, '#goalError')).toBe('目標日は今日以降の日付にしてください。');
  $('#gDeadline').value = '2027-03-31';
  $('#gWage').value = '1300';
  $('#gTarget').value = '200000.6';
  $('#gClosing').value = '15';
  $('#gPayDay').value = '5';
  submit('#goalForm');
  expect($('#dlgSettings').open).toBe(false);
  expect(saved(w).goal).toMatchObject({
    target: 200001,
    hourlyWage: 1300,
    closingDay: 15,
    payDay: 5,
  });
  expect(saved(w).shifts[0].wage).toBe(1100);
  expect(txt(w, '#toast')).toBe('目標を保存しました');
  $('#openSettings').click();
  expect(txt(w, '#goalError')).toBe('');
});

test('設定: 期限切れでも目標日を変えなければ保存できる', async () => {
  const w = await boot({ ...sample, goal: { ...sample.goal, deadline: '2026-09-30' } });
  const { $, submit } = helpers(w);
  $('#openSettings').click();
  $('#gWage').value = '1500';
  submit('#goalForm');
  expect(saved(w).goal.hourlyWage).toBe(1500);
});

test('初回設定の検証', async () => {
  const w = await boot(null);
  const { $, submit } = helpers(w);
  expect($('#sDeadline').min).toBe('2026-10-03');
  submit('#setupForm');
  expect(txt(w, '#setupError')).toBe('いまの貯金は0円以上の数字で入力してください。');
  $('#sCurrent').value = '100000';
  $('#sTarget').value = '100000';
  $('#sWage').value = '1000';
  $('#sDeadline').value = '2027-01-01';
  submit('#setupForm');
  expect(txt(w, '#setupError')).toBe('目標金額は、いまの貯金より大きくしてください。');
  $('#sDeadline').value = '2026-10-02';
  submit('#setupForm');
  expect(txt(w, '#setupError')).toBe('目標日は今日以降の日付にしてください。');
  $('#sDeadline').value = '2027-01-01';
  $('#sTarget').value = '150000';
  submit('#setupForm');
  expect(txt(w, '#setupError')).toBe('');
  expect(saved(w).goal).toMatchObject({
    baseSavings: 100000,
    target: 150000,
    hourlyWage: 1000,
    createdAt: new Date().toISOString(),
  });
});

test('JSON エクスポート', async () => {
  let link;
  const w = await boot(sample, undefined, (w) => {
    w.HTMLAnchorElement.prototype.click = function () {
      link = { download: this.download, href: this.href, inDoc: this.isConnected };
    };
  });
  let blob;
  vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
    blob = b;
    return 'blob:x';
  });
  const { $ } = helpers(w);
  $('#openSettings').click();
  $('#exportBtn').click();
  expect(link).toEqual({ download: 'savings-pace-2026-10-03.json', href: 'blob:x', inDoc: true });
  expect(blob.type).toBe('application/json');
  const text = await blob.text();
  expect(text).toBe(JSON.stringify({ ...sample, exportedAt: new Date().toISOString() }, null, 2));
  expect($('#dlgSettings').open).toBe(false);
  expect(txt(w, '#toast')).toBe('エクスポートしました');
  vi.restoreAllMocks();
});

const pickFile = (w, text) => {
  const input = w.document.querySelector('#fileInput');
  Object.defineProperty(input, 'files', {
    value: [{ text: async () => text }],
    configurable: true,
  });
  input.dispatchEvent(new w.Event('change'));
};

test('JSON インポート: 初回設定画面からは確認なしで取り込む（exportedAt は残らない）', async () => {
  const w = await boot(null);
  pickFile(w, JSON.stringify(exported));
  await tick();
  await tick();
  expect(w.document.querySelector('#mainView').hidden).toBe(false);
  expect(saved(w)).not.toHaveProperty('exportedAt');
  expect(saved(w).shifts).toHaveLength(6);
  expect(txt(w, '#toast')).toBe('インポートしました');
});

test('JSON インポート: 既存データは置き換え確認、失敗はエラートーストで状態不変', async () => {
  const w = await boot({ ...sample, shifts: [] });
  const { $ } = helpers(w);
  $('#openSettings').click();
  pickFile(w, '{not json');
  await tick();
  expect($('#dlgSettings').open).toBe(false);
  expect(txt(w, '#toast')).toBe('JSONとして読み取れませんでした。');
  expect($('#toast').classList.contains('err')).toBe(true);
  pickFile(w, JSON.stringify({ ...exported, app: 'x' }));
  await tick();
  expect(txt(w, '#toast')).toBe('このアプリで書き出したファイルではありません。');
  expect(saved(w).shifts).toHaveLength(0);

  pickFile(w, JSON.stringify(exported));
  await tick();
  await tick();
  expect($('#dlgConfirm').open).toBe(true);
  expect(txt(w, '#cfMsg')).toBe(
    'いまのデータは消え、読み込んだ内容（勤務記録6件、目標金額¥300,000）に置き換わります。',
  );
  $('#cfOk').click();
  await tick();
  expect(saved(w).shifts).toHaveLength(6);
  expect($('#toast').classList.contains('err')).toBe(false);
});

test('ダイアログ: data-close と背景クリックで閉じる', async () => {
  const w = await boot(sample);
  const { $ } = helpers(w);
  $('#openSettings').click();
  $('#dlgSettings [data-close]').click();
  expect($('#dlgSettings').open).toBe(false);
  $('#editSavings').click();
  $('#dlgSavings').click();
  expect($('#dlgSavings').open).toBe(false);
});

test('勤務を開始・終了時刻で記録: 15分きざみで切り捨て、時間・分より優先', async () => {
  const w = await boot(sample);
  const { $, set, submit } = helpers(w);
  set('#shiftH', '1');
  set('#shiftStart', '17:00');
  set('#shiftEnd', '9:00');
  submit('#shiftForm');
  expect(txt(w, '#shiftError')).toBe('終了時刻は開始時刻より後にしてください。');
  expect(saved(w).shifts).toHaveLength(6);
  set('#shiftStart', '9:05');
  set('#shiftEnd', '13:52');
  expect(txt(w, '#shiftPreview')).toBe('4時間47分 → +¥5,700');
  submit('#shiftForm');
  expect(saved(w).shifts.at(-1)).toMatchObject({ minutes: 287, wage: 1200, earned: 5700 });
  expect([$('#shiftStart').value, $('#shiftEnd').value]).toEqual(['', '']);
});
