import { $ } from './dom.js';
import { todayDay } from '../core/clock.js';
import { DEFAULT_CLOSING, DEFAULT_PAYDAY } from '../core/payCycle.js';
import { readNum, goalError } from '../core/validation.js';
import { removeSaved } from '../store/storage.js';
import { state, setState } from '../store/state.js';
import { render, save } from './render.js';
import { resetShiftForm } from './shiftForm.js';
import { confirmDialog } from './dialogs.js';
import { toast } from './toast.js';

export function init() {
  const dlgSettings = $('#dlgSettings');
  $('#openSettings').addEventListener('click', () => {
    $('#gTarget').value = state.goal.target;
    $('#gDeadline').value = state.goal.deadline;
    $('#gWage').value = state.goal.hourlyWage;
    $('#gClosing').value = state.goal.closingDay;
    $('#gPayDay').value = state.goal.payDay;
    $('#goalError').textContent = '';
    dlgSettings.showModal();
  });
  $('#goalForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const target = readNum($('#gTarget').value);
    const wage = readNum($('#gWage').value);
    const deadline = $('#gDeadline').value;
    const closing = readNum($('#gClosing').value);
    const payDay = readNum($('#gPayDay').value);
    const changed = deadline !== state.goal.deadline;
    const ge = goalError({ target, deadline, wage, closing, payDay }, changed, todayDay());
    if (ge) {
      $('#goalError').textContent = ge;
      return;
    }
    state.goal.target = Math.round(target);
    state.goal.deadline = deadline;
    state.goal.hourlyWage = wage;
    state.goal.closingDay = closing;
    state.goal.payDay = payDay;
    save();
    dlgSettings.close();
    render();
    toast('目標を保存しました');
  });

  $('#resetBtn').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'すべてのデータを削除しますか？',
      message:
        'この端末に保存された目標と勤務履歴を消します。元に戻せません。必要な場合は先にエクスポートしてください。',
      ok: '削除する',
      danger: true,
    });
    if (!ok) return;
    removeSaved();
    setState(null);
    dlgSettings.close();
    resetShiftForm();
    ['#sCurrent', '#sTarget', '#sWage', '#sDeadline'].forEach((s) => {
      $(s).value = '';
    });
    $('#sClosing').value = DEFAULT_CLOSING;
    $('#sPayDay').value = DEFAULT_PAYDAY;
    render();
    toast('削除しました');
  });
}
