// フォーム入力の検証（初回設定・設定画面・勤務フォーム）。値は input.value の文字列を受ける
import { parseISO, isoDay } from './dates.js';

// 空欄 → NaN
export function readNum(value) {
  const v = value.trim();
  if (v === '') return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

// today は dayNum。checkDeadline のときだけ「今日以降」を検証する
export function goalError({ target, deadline, wage, closing, payDay }, checkDeadline, today) {
  if (!(target > 0)) return '目標金額は1円以上の数字で入力してください。';
  if (!parseISO(deadline)) return '目標を達成する日を選んでください。';
  if (checkDeadline && isoDay(deadline) < today) return '目標日は今日以降の日付にしてください。';
  if (!(wage > 0)) return '時給は1円以上の数字で入力してください。';
  const okDay = (v) => Number.isInteger(v) && v >= 1 && v <= 31;
  if (!okDay(closing)) return '締め日は1〜31の整数で入力してください（月末は31）。';
  if (!okDay(payDay)) return '支払日は1〜31の整数で入力してください。';
  return '';
}

const optNum = (v) => (String(v).trim() === '' ? 0 : Number(v));

// 勤務時間（時間・分の入力値）→ { min } または { error }
export function formMinutes(hValue, mValue) {
  const h = optNum(hValue);
  const m = optNum(mValue);
  if (!Number.isFinite(h) || !Number.isFinite(m))
    return { error: '勤務時間は数字で入力してください。' };
  if (h < 0 || m < 0) return { error: '勤務時間は0以上で入力してください。' };
  if (m >= 60) return { error: '分は0〜59で入力してください。' };
  const min = Math.round(h * 60) + Math.round(m);
  if (min <= 0) return { error: '勤務時間を入力してください。' };
  if (min > 1440) return { error: '勤務時間は24時間以内で入力してください。' };
  return { min };
}

// 開始・終了時刻（"13:52"）→ { min } または { error }。両方空欄なら null
export function formTimes(startValue, endValue) {
  const s = startValue.trim();
  const e = endValue.trim();
  if (s === '' && e === '') return null;
  const toMin = (v) => {
    const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(v);
    return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
  };
  const a = toMin(s);
  const b = toMin(e);
  if (Number.isNaN(a) || Number.isNaN(b))
    return { error: '開始・終了時刻は 13:52 のように入力してください。' };
  if (b <= a) return { error: '終了時刻は開始時刻より後にしてください。' };
  return { min: b - a };
}
