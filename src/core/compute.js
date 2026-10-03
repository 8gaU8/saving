import { dayNum, isoDay, isoOfDay, monthEndDay } from './dates.js';
import { lastCountedWorkDay } from './payCycle.js';
import { money } from './money.js';

// 必要時間の算出。t は今日 { y, m, d, dow }（clock.now() の形）
export function compute(state, t) {
  const g = state.goal;
  const today = dayNum(t.y, t.m, t.d);
  const mo = money(state, today);
  const savings = mo.cash;
  // 入金待ちのうち、目標日までに入金される分は「確定した収入」として差し引く
  const remaining = Math.max(0, g.target - savings - mo.pendingCounted);
  const remainingHours = remaining / g.hourlyWage;
  const iso = isoOfDay(today);
  const loggedToday = state.shifts.some((s) => s.date === iso);
  const start = loggedToday ? today + 1 : today;
  const deadline = isoDay(g.deadline);
  const lastWork = lastCountedWorkDay(deadline, g); // これ以降の勤務は目標日に間に合わない
  const daysLeft = lastWork === null ? 0 : lastWork - start + 1;
  const out = {
    savings, remaining, remainingHours, daysLeft, deadline, lastWork,
    lateEarned: mo.pending - mo.pendingCounted,
    achieved: remaining <= 0,
    cashReached: savings >= g.target,
    expired: remaining > 0 && daysLeft <= 0
  };
  if (out.achieved || out.expired) return out;

  const weekEnd = today + (6 - ((t.dow + 6) % 7)); // 月曜はじまり・日曜おわり
  const period = (endDay) => {
    const end = Math.min(endDay, lastWork);
    const days = Math.max(0, end - start + 1);
    return { end, days, hours: remainingHours * days / daysLeft };
  };
  out.week = period(weekEnd);
  out.month = period(monthEndDay(t.y, t.m));
  out.perDay = remainingHours / daysLeft;
  return out;
}
