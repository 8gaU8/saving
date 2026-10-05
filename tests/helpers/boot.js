// UI テスト用: 新しい jsdom を作り、グローバルを差し替えてから src/main.js を読み込む。
// reference-tests の boot() と同じポリフィル。時計は vi.useFakeTimers で Date だけ固定する。
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { vi, afterEach } from 'vitest';

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
  .replace(/<link[^>]*fonts[^>]*>/g, '')
  .replace(/<script type="module"[^>]*><\/script>/, '');

export const FIXED = new Date(2026, 9, 3, 12, 0, 0); // 2026-10-03 (土)
const GLOBALS = [
  'window',
  'document',
  'localStorage',
  'navigator',
  'HTMLDialogElement',
  'Image',
  'Event',
];

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// state: オブジェクト（JSON 化して保存）か生の文字列。before(w) はモジュール読み込み前に呼ぶ
export async function boot(state, now = FIXED, before) {
  vi.useFakeTimers({ now, toFake: ['Date'] });
  const w = new JSDOM(html, { url: 'https://x.example/', pretendToBeVisual: true }).window;
  w.HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  w.HTMLDialogElement.prototype.close = function () {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    this.dispatchEvent(new w.Event('close'));
  };
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.scrollTo = () => {};
  w.matchMedia = () => ({ matches: false });
  if (state)
    w.localStorage.setItem(
      'savings-pace:v1',
      typeof state === 'string' ? state : JSON.stringify(state),
    );
  if (before) before(w);
  for (const k of GLOBALS) vi.stubGlobal(k, w[k]);
  vi.resetModules();
  await import('../../src/main.js');
  return w;
}

export const txt = (w, sel) =>
  w.document.querySelector(sel).textContent.replace(/\s+/g, ' ').trim();
