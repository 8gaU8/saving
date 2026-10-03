// 給与サイクル（N日締め・翌月M日払い）
import { parseISO, partsOfDay, dayNum, dim, addMonth } from './dates.js';

export const DEFAULT_CLOSING = 31; // 31 = 月末締め
export const DEFAULT_PAYDAY = 25;

// 勤務日 → 入金日（dayNum）
export function payDayOf(dateISO, g) {
  const p = parseISO(dateISO);
  const c = Math.min(g.closingDay, dim(p.y, p.m));
  const cm = p.d <= c ? { y: p.y, m: p.m } : addMonth(p.y, p.m, 1);
  const pm = addMonth(cm.y, cm.m, 1);
  return dayNum(pm.y, pm.m, Math.min(g.payDay, dim(pm.y, pm.m)));
}
// 目標日までに入金される最後の勤務日（dayNum）。なければ null
export function lastCountedWorkDay(deadline, g) {
  const dp = partsOfDay(deadline);
  for (let k = 0; k <= 3; k++) {
    const cm = addMonth(dp.y, dp.m, -k);
    const closing = dayNum(cm.y, cm.m, Math.min(g.closingDay, dim(cm.y, cm.m)));
    const pm = addMonth(cm.y, cm.m, 1);
    const pay = dayNum(pm.y, pm.m, Math.min(g.payDay, dim(pm.y, pm.m)));
    if (pay <= deadline) return closing;
  }
  return null;
}
