import { $ } from './dom.js';
import { todayISO } from '../core/clock.js';
import { normalizeState } from '../core/schema.js';
import { state } from '../store/state.js';
import { adoptState } from './adopt.js';
import { toast } from './toast.js';

export function init() {
  const dlgSettings = $('#dlgSettings');
  $('#exportBtn').addEventListener('click', () => {
    const data = { ...state, exportedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `savings-pace-${todayISO()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    dlgSettings.close();
    toast('エクスポートしました');
  });

  const fileInput = $('#fileInput');
  $('#importBtn').addEventListener('click', () => fileInput.click());
  $('#setupImport').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    dlgSettings.close();
    let next;
    try {
      let obj;
      try {
        obj = JSON.parse(await file.text());
      } catch (_) {
        throw new Error('JSONとして読み取れませんでした。');
      }
      next = normalizeState(obj);
    } catch (err) {
      toast(err.message || '読み込みに失敗しました。', true);
      return;
    }
    await adoptState(next);
  });
}
