import { $ } from './dom.js';
import { todayDay } from '../core/clock.js';
import { APP_ID, SCHEMA } from '../core/schema.js';
import { readNum, goalError } from '../core/validation.js';
import { setState } from '../store/state.js';
import { ui, PAGE_SIZE } from './uiState.js';
import { render, save } from './render.js';
import { resetShiftForm } from './shiftForm.js';

export function init() {
  $('#setupForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const cur = readNum($('#sCurrent').value);
    const target = readNum($('#sTarget').value);
    const wage = readNum($('#sWage').value);
    const deadline = $('#sDeadline').value;
    const err = $('#setupError');
    if (!(cur >= 0)) {
      err.textContent = 'いまの貯金は0円以上の数字で入力してください。';
      return;
    }
    const closing = readNum($('#sClosing').value);
    const payDay = readNum($('#sPayDay').value);
    const ge = goalError({ target, deadline, wage, closing, payDay }, true, todayDay());
    if (ge) {
      err.textContent = ge;
      return;
    }
    if (!(target > cur)) {
      err.textContent = '目標金額は、いまの貯金より大きくしてください。';
      return;
    }
    err.textContent = '';
    setState({
      app: APP_ID,
      schemaVersion: SCHEMA,
      goal: {
        baseSavings: Math.round(cur),
        target: Math.round(target),
        deadline,
        hourlyWage: wage,
        closingDay: closing,
        payDay,
        createdAt: new Date().toISOString(),
      },
      shifts: [],
      adjustments: [],
    });
    save();
    ui.historyLimit = PAGE_SIZE;
    resetShiftForm();
    render();
    window.scrollTo(0, 0);
  });
}
