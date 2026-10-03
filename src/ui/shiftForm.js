import { $, reducedMotion } from './dom.js';
import { parseISO, isoDay } from '../core/dates.js';
import { todayISO, todayDay } from '../core/clock.js';
import { yen, fmtHM } from '../core/format.js';
import { earnedOf } from '../core/money.js';
import { newId } from '../core/schema.js';
import { formMinutes } from '../core/validation.js';
import { state } from '../store/state.js';
import { ui } from './uiState.js';
import { render, save } from './render.js';
import { toast } from './toast.js';

function updatePreview() {
  const el = $('#shiftPreview');
  const r = formMinutes($('#shiftH').value, $('#shiftM').value);
  if (r.error || !state) { el.textContent = ''; return; }
  const editing = ui.editingId ? state.shifts.find((s) => s.id === ui.editingId) : null;
  const wage = editing ? editing.wage : state.goal.hourlyWage;
  el.textContent = `${fmtHM(r.min)} → +${yen(earnedOf(r.min, wage))}`;
}

export function resetShiftForm() {
  ui.editingId = null;
  $('#shiftDate').value = todayISO();
  ui.defaultDate = todayISO();
  $('#shiftH').value = '';
  $('#shiftM').value = '';
  $('#shiftError').textContent = '';
  $('#shiftPreview').textContent = '';
  $('#formTitle').textContent = '勤務を記録';
  $('#shiftSubmit').textContent = '記録する';
  $('#shiftCancel').hidden = true;
}

export function startEdit(id) {
  const s = state.shifts.find((x) => x.id === id);
  if (!s) return;
  ui.editingId = id;
  $('#shiftDate').value = s.date;
  $('#shiftH').value = Math.floor(s.minutes / 60);
  $('#shiftM').value = s.minutes % 60;
  $('#shiftError').textContent = '';
  $('#formTitle').textContent = '勤務を編集';
  $('#shiftSubmit').textContent = '更新する';
  $('#shiftCancel').hidden = false;
  updatePreview();
  $('#shiftForm').scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' });
  $('#shiftH').focus({ preventScroll: true });
}

export function init() {
  $('#shiftForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const err = $('#shiftError');
    const date = $('#shiftDate').value;
    if (!parseISO(date)) { err.textContent = '日付を選んでください。'; return; }
    if (isoDay(date) > todayDay()) { err.textContent = '今日より先の日付は記録できません。'; return; }
    const r = formMinutes($('#shiftH').value, $('#shiftM').value);
    if (r.error) { err.textContent = r.error; return; }
    err.textContent = '';
    if (ui.editingId) {
      const s = state.shifts.find((x) => x.id === ui.editingId);
      if (s) { s.date = date; s.minutes = r.min; s.earned = earnedOf(r.min, s.wage); }
      toast('勤務を更新しました');
    } else {
      state.shifts.push({
        id: newId(), date, minutes: r.min,
        wage: state.goal.hourlyWage,
        earned: earnedOf(r.min, state.goal.hourlyWage),
        at: new Date().toISOString()
      });
      toast('勤務を記録しました');
    }
    save();
    resetShiftForm();
    render();
  });
  $('#shiftCancel').addEventListener('click', resetShiftForm);
  $('#shiftH').addEventListener('input', updatePreview);
  $('#shiftM').addEventListener('input', updatePreview);
}
