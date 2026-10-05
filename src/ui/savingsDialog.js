import { $ } from './dom.js';
import { todayISO, todayDay } from '../core/clock.js';
import { money } from '../core/money.js';
import { newId } from '../core/schema.js';
import { state } from '../store/state.js';
import { render, save } from './render.js';
import { toast } from './toast.js';

const savingsNow = (s) => money(s, todayDay()).cash;

export function init() {
  const dlgSavings = $('#dlgSavings');
  $('#editSavings').addEventListener('click', () => {
    $('#svInput').value = Math.round(savingsNow(state));
    $('#svError').textContent = '';
    dlgSavings.showModal();
    $('#svInput').select();
  });
  $('#savingsForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const raw = $('#svInput').value.trim();
    const v = raw === '' ? NaN : Number(raw);
    if (!(v >= 0)) {
      $('#svError').textContent = '0以上の数字で入力してください。';
      return;
    }
    const next = Math.round(v);
    const delta = next - Math.round(savingsNow(state));
    dlgSavings.close();
    if (delta === 0) return;
    state.adjustments.push({ id: newId(), date: todayISO(), delta, at: new Date().toISOString() });
    save();
    render();
    toast('貯金額を修正しました');
  });
}
