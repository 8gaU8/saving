// 現在の状態。importer からは読み取り専用（live binding）。書き換えは setState、保存は persist
import { STORAGE_KEY, load, save } from './storage.js';

export let state = null;

export const setState = (next) => {
  state = next;
};
export const persist = () => save(state);
export const reload = () => {
  state = load();
};

// 別タブでの変更を反映する。onChange は再読込の後に呼ぶ
export function watchOtherTabs(onChange) {
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY || e.key === null) {
      state = load();
      onChange();
    }
  });
}
