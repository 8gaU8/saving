// 日付は YYYY-MM-DD 文字列で持ち、計算は UTC 0時基準の通算日数（dayNum）で行う
export const pad = (n) => String(n).padStart(2, '0');

export const dayNum = (y, m, d) => Math.floor(Date.UTC(y, m - 1, d) / 86400000);
export function parseISO(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
  if (!m) return null;
  const y = +m[1],
    mo = +m[2],
    d = +m[3];
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return { y, m: mo, d };
}
export const isoDay = (s) => {
  const p = parseISO(s);
  return p ? dayNum(p.y, p.m, p.d) : null;
};
export const partsOfDay = (n) => {
  const t = new Date(n * 86400000);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), dow: t.getUTCDay() };
};
export const isoOfDay = (n) => {
  const p = partsOfDay(n);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
};
export const monthEndDay = (y, m) => dayNum(y, m + 1, 0);
export const dim = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // その月の日数
export const addMonth = (y, m, k) => {
  const t = y * 12 + (m - 1) + k;
  return { y: Math.floor(t / 12), m: (t % 12) + 1 };
};
