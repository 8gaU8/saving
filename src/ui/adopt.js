import { yen } from '../core/format.js';
import { state, setState } from '../store/state.js';
import { ui, PAGE_SIZE } from './uiState.js';
import { render, save } from './render.js';
import { resetShiftForm } from './shiftForm.js';
import { confirmDialog } from './dialogs.js';
import { toast } from './toast.js';

// 読み込んだデータを現在のデータと入れ替える（JSON・QR共通）
export async function adoptState(next) {
  if (state) {
    const ok = await confirmDialog({
      title: 'データを置き換えますか？',
      message: `いまのデータは消え、読み込んだ内容（勤務記録${next.shifts.length}件、目標金額${yen(next.goal.target)}）に置き換わります。`,
      ok: '置き換える', danger: true
    });
    if (!ok) return false;
  }
  setState(next);
  save();
  ui.historyLimit = PAGE_SIZE;
  resetShiftForm();
  render();
  toast('インポートしました');
  return true;
}
