// localStorage のラッパ。キーとスキーマは変更禁止
import { normalizeState } from '../core/schema.js';

export const STORAGE_KEY = 'savings-pace:v1';

// 保存できる環境か（false なら UI が警告バナーを出す）
export let storageOK = true;

// 起動時の書き込みプローブ（プライベートモード等の検出）
export function probe() {
  try {
    localStorage.setItem('__probe', '1');
    localStorage.removeItem('__probe');
  } catch {
    storageOK = false;
  }
}

// 読み込み。壊れたデータは :broken に退避して null
export function load() {
  let raw = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    storageOK = false;
    return null;
  }
  if (!raw) return null;
  try {
    return normalizeState(JSON.parse(raw));
  } catch {
    try {
      localStorage.setItem(STORAGE_KEY + ':broken', raw);
    } catch {
      /* ignore */
    }
    return null;
  }
}

export function save(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    storageOK = true;
  } catch {
    storageOK = false;
  }
}

export function removeSaved() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
