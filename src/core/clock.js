// 「今日」はブラウザのローカル日付。UI が呼ぶ唯一の入口（core の計算関数には引数で渡す）
import { pad, dayNum } from './dates.js';

export const now = () => {
  const t = new Date();
  return { y: t.getFullYear(), m: t.getMonth() + 1, d: t.getDate(), dow: t.getDay() };
};
export const todayISO = () => {
  const t = now();
  return `${t.y}-${pad(t.m)}-${pad(t.d)}`;
};
export const todayDay = () => {
  const t = now();
  return dayNum(t.y, t.m, t.d);
};
