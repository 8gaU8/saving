// 履歴の操作（編集・削除・さらに表示）。描画は render.js の renderHistory
import { $ } from './dom.js';
import { yen, fmtHM } from '../core/format.js';
import { state } from '../store/state.js';
import { ui, PAGE_SIZE } from './uiState.js';
import { render, renderHistory, save, fmtISO } from './render.js';
import { startEdit, resetShiftForm } from './shiftForm.js';
import { confirmDialog } from './dialogs.js';
import { toast } from './toast.js';

export function init() {
  $('#historyList').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const id = b.dataset.id;
    if (b.dataset.act === 'edit') {
      startEdit(id);
      return;
    }
    if (b.dataset.act === 'del') {
      const s = state.shifts.find((x) => x.id === id);
      if (!s) return;
      const ok = await confirmDialog({
        title: 'この勤務記録を削除しますか？',
        message: `${fmtISO(s.date)}・${fmtHM(s.minutes)}（${yen(s.earned)}）を削除すると、この金額が貯金額・入金待ちから外れます。`,
        ok: '削除する',
        danger: true,
      });
      if (!ok) return;
      state.shifts = state.shifts.filter((x) => x.id !== id);
      if (ui.editingId === id) resetShiftForm();
      save();
      render();
      toast('削除しました');
    }
    if (b.dataset.act === 'delAdj') {
      const a = state.adjustments.find((x) => x.id === id);
      if (!a) return;
      const ok = await confirmDialog({
        title: 'この修正を取り消しますか？',
        message: `${fmtISO(a.date)}の貯金額の修正（${a.delta >= 0 ? '+' : ''}${yen(a.delta)}）を取り消すと、貯金額が元に戻ります。`,
        ok: '取り消す',
        danger: true,
      });
      if (!ok) return;
      state.adjustments = state.adjustments.filter((x) => x.id !== id);
      save();
      render();
      toast('取り消しました');
    }
  });
  $('#moreBtn').addEventListener('click', () => {
    ui.historyLimit += PAGE_SIZE;
    renderHistory();
  });
}
