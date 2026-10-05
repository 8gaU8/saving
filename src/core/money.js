import { isoDay } from './dates.js';
import { payDayOf } from './payCycle.js';

export const earnedOf = (minutes, wage) => Math.round((minutes * wage) / 60);

// 貯金（入金済みの分）と入金待ちの内訳。today は dayNum
export function money(s, today) {
  const g = s.goal,
    deadline = isoDay(g.deadline);
  let cash = g.baseSavings + s.adjustments.reduce((a, x) => a + x.delta, 0);
  let pending = 0,
    pendingCounted = 0,
    nextPay = null;
  for (const x of s.shifts) {
    const pd = payDayOf(x.date, g);
    if (pd <= today) {
      cash += x.earned;
      continue;
    }
    pending += x.earned;
    if (pd <= deadline) pendingCounted += x.earned;
    if (nextPay === null || pd < nextPay) nextPay = pd;
  }
  return { cash, pending, pendingCounted, nextPay };
}

// 勤務フォームから記録する給料: 15分きざみ、端数は切り捨て
export const payOf = (minutes, wage) => earnedOf(Math.floor(minutes / 15) * 15, wage);
