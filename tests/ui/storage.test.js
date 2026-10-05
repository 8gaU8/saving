import { test, expect } from 'vitest';
import { boot, txt } from '../helpers/boot.js';
import state from '../fixtures/sample-state.json';

const KEY = 'savings-pace:v1';
const tick = () => new Promise((r) => setTimeout(r, 0));

test('壊れた JSON は :broken に退避して初回設定へ', async () => {
  const w = await boot('{oops');
  expect(w.document.querySelector('#setupView').hidden).toBe(false);
  expect(w.localStorage.getItem(KEY + ':broken')).toBe('{oops');
  expect(w.localStorage.getItem(KEY)).toBe('{oops'); // 元のキーは消さない
});

test('検証で落ちる状態も :broken に退避', async () => {
  const w = await boot({ ...state, app: 'other' });
  expect(w.document.querySelector('#setupView').hidden).toBe(false);
  expect(JSON.parse(w.localStorage.getItem(KEY + ':broken')).app).toBe('other');
});

test('書き込めない環境ではプローブで警告バナーを出す', async () => {
  const w = await boot(state, undefined, (w) => {
    w.Storage.prototype.setItem = () => {
      throw new Error('QuotaExceededError');
    };
  });
  expect(w.document.querySelector('#storageWarn').hidden).toBe(false);
  expect(w.document.querySelector('#mainView').hidden).toBe(false); // 読み込みはできる
});

test('読み込めない環境（getItem 例外）は初回設定 + 警告', async () => {
  const w = await boot(null, undefined, (w) => {
    w.Storage.prototype.getItem = () => {
      throw new Error('SecurityError');
    };
  });
  expect(w.document.querySelector('#setupView').hidden).toBe(false);
  expect(w.document.querySelector('#storageWarn').hidden).toBe(false);
});

test('保存に成功すると警告が消える', async () => {
  let fail = true;
  const w = await boot(state, undefined, (w) => {
    const orig = w.Storage.prototype.setItem;
    w.Storage.prototype.setItem = function (...a) {
      if (fail) throw new Error('x');
      return orig.apply(this, a);
    };
  });
  expect(w.document.querySelector('#storageWarn').hidden).toBe(false);
  fail = false;
  const $ = (s) => w.document.querySelector(s);
  $('#shiftH').value = '1';
  $('#shiftForm').dispatchEvent(new w.Event('submit', { cancelable: true }));
  expect($('#storageWarn').hidden).toBe(true);
  expect(JSON.parse(w.localStorage.getItem(KEY)).shifts).toHaveLength(7);
});

test('他タブの変更（storage イベント）で再読込・再描画', async () => {
  const w = await boot(state);
  w.localStorage.setItem(
    KEY,
    JSON.stringify({ ...state, goal: { ...state.goal, target: 400000 } }),
  );
  w.dispatchEvent(new w.StorageEvent('storage', { key: 'other-key' }));
  expect(txt(w, '#barTarget')).toBe('目標 ¥300,000');
  w.dispatchEvent(new w.StorageEvent('storage', { key: KEY }));
  expect(txt(w, '#barTarget')).toBe('目標 ¥400,000');
  w.localStorage.clear();
  w.dispatchEvent(new w.StorageEvent('storage', { key: null }));
  expect(w.document.querySelector('#setupView').hidden).toBe(false);
});

test('全データ削除: 確認 → キー削除 → 初回設定（締め31・支払25に戻す）', async () => {
  const w = await boot(state);
  const $ = (s) => w.document.querySelector(s);
  $('#sClosing').value = '15';
  $('#openSettings').click();
  $('#resetBtn').click();
  expect($('#dlgConfirm').open).toBe(true);
  $('#cfOk').click();
  await tick();
  expect(w.localStorage.getItem(KEY)).toBeNull();
  expect($('#setupView').hidden).toBe(false);
  expect($('#sClosing').value).toBe('31');
  expect($('#sPayDay').value).toBe('25');
  expect(txt(w, '#toast')).toBe('削除しました');
});
