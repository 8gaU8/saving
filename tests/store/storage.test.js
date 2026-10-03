// @vitest-environment jsdom
import { test, expect, beforeEach, vi } from 'vitest';
import sample from '../fixtures/sample-state.json';

const KEY = 'savings-pace:v1';
let st;
beforeEach(async () => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.resetModules(); // storageOK をリセット
  st = await import('../../src/store/storage.js');
});

test('空なら null、保存した状態はそのまま読める', () => {
  expect(st.load()).toBeNull();
  st.save(sample);
  expect(localStorage.getItem(KEY)).toBe(JSON.stringify(sample));
  expect(st.load()).toEqual(sample);
  st.removeSaved();
  expect(localStorage.getItem(KEY)).toBeNull();
});

test('壊れたデータは :broken に退避して null', () => {
  localStorage.setItem(KEY, '[1,2');
  expect(st.load()).toBeNull();
  expect(localStorage.getItem(KEY + ':broken')).toBe('[1,2');
});

test('保存の失敗・成功で storageOK が切り替わる', () => {
  const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
  st.probe();
  expect(st.storageOK).toBe(false);
  spy.mockRestore();
  st.save(sample);
  expect(st.storageOK).toBe(true);
});

test('getItem が例外なら storageOK=false で null', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
  expect(st.load()).toBeNull();
  expect(st.storageOK).toBe(false);
});

test('state.js: 他タブの変更は対象キーと clear のときだけ再読込', async () => {
  const s = await import('../../src/store/state.js');
  const onChange = vi.fn();
  s.watchOtherTabs(onChange);
  st.save(sample);
  window.dispatchEvent(new StorageEvent('storage', { key: 'x' }));
  expect(s.state).toBeNull();
  window.dispatchEvent(new StorageEvent('storage', { key: KEY }));
  expect(s.state).toEqual(sample);
  expect(onChange).toHaveBeenCalledTimes(1);
});
