import qrcode from 'qrcode-generator';
import jsQR from 'jsqr';
import './styles/main.css';

const STORAGE_KEY = 'savings-pace:v1';
const APP_ID = 'savings-pace';
const SCHEMA = 1;
const MAX_ROWS = 20000;
const PAGE_SIZE = 20;
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

const $ = (sel, root = document) => root.querySelector(sel);
const pad = (n) => String(n).padStart(2, '0');
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

/* ---------- 日付 ---------- */
const dayNum = (y, m, d) => Math.floor(Date.UTC(y, m - 1, d) / 86400000);
function parseISO(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return { y, m: mo, d };
}
const isoDay = (s) => { const p = parseISO(s); return p ? dayNum(p.y, p.m, p.d) : null; };
const partsOfDay = (n) => {
  const t = new Date(n * 86400000);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), dow: t.getUTCDay() };
};
const now = () => { const t = new Date(); return { y: t.getFullYear(), m: t.getMonth() + 1, d: t.getDate(), dow: t.getDay() }; };
const todayISO = () => { const t = now(); return `${t.y}-${pad(t.m)}-${pad(t.d)}`; };
const todayDay = () => { const t = now(); return dayNum(t.y, t.m, t.d); };
const monthEndDay = (y, m) => dayNum(y, m + 1, 0);
const dim = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // その月の日数
const addMonth = (y, m, k) => { const t = y * 12 + (m - 1) + k; return { y: Math.floor(t / 12), m: (t % 12) + 1 }; };

/* ---------- 給与サイクル（N日締め・翌月M日払い） ---------- */
const DEFAULT_CLOSING = 31; // 31 = 月末締め
const DEFAULT_PAYDAY = 25;
// 勤務日 → 入金日（dayNum）
function payDayOf(dateISO, g) {
  const p = parseISO(dateISO);
  const c = Math.min(g.closingDay, dim(p.y, p.m));
  const cm = p.d <= c ? { y: p.y, m: p.m } : addMonth(p.y, p.m, 1);
  const pm = addMonth(cm.y, cm.m, 1);
  return dayNum(pm.y, pm.m, Math.min(g.payDay, dim(pm.y, pm.m)));
}
// 目標日までに入金される最後の勤務日（dayNum）。なければ null
function lastCountedWorkDay(deadline, g) {
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

/* ---------- 表示用フォーマット ---------- */
const yen = (n) => (n < 0 ? '−' : '') + '¥' + Math.abs(Math.round(n)).toLocaleString('ja-JP');
const ceil1 = (h) => Math.ceil(h * 10 - 1e-9) / 10;
const fmtH = (h) => { const v = ceil1(h); return Number.isInteger(v) ? String(v) : v.toFixed(1); };
const fmtHM = (min) => {
  const h = Math.floor(min / 60), m = min % 60;
  if (h && m) return `${h}時間${m}分`;
  if (h) return `${h}時間`;
  return `${m}分`;
};
const fmtDay = (n, withYear) => { const p = partsOfDay(n); return `${withYear ? p.y + '年' : ''}${p.m}月${p.d}日`; };
const fmtISO = (s) => {
  const p = partsOfDay(isoDay(s));
  return `${p.y !== now().y ? p.y + '年' : ''}${p.m}月${p.d}日（${WEEKDAYS[p.dow]}）`;
};

/* ---------- 状態 ---------- */
let state = null;
let editingId = null;
let historyLimit = PAGE_SIZE;
let storageOK = true;
let defaultDate = '';

const earnedOf = (minutes, wage) => Math.round(minutes * wage / 60);
// 貯金（入金済みの分）と入金待ちの内訳
function money(s) {
  const g = s.goal, today = todayDay(), deadline = isoDay(g.deadline);
  let cash = g.baseSavings + s.adjustments.reduce((a, x) => a + x.delta, 0);
  let pending = 0, pendingCounted = 0, nextPay = null;
  for (const x of s.shifts) {
    const pd = payDayOf(x.date, g);
    if (pd <= today) { cash += x.earned; continue; }
    pending += x.earned;
    if (pd <= deadline) pendingCounted += x.earned;
    if (nextPay === null || pd < nextPay) nextPay = pd;
  }
  return { cash, pending, pendingCounted, nextPay };
}
const savingsNow = (s) => money(s).cash;

function normalizeState(o) {
  const fail = (m) => { throw new Error(m); };
  if (!o || typeof o !== 'object' || Array.isArray(o)) fail('ファイルの形式が正しくありません。');
  if (o.app !== APP_ID) fail('このアプリで書き出したファイルではありません。');
  if (o.schemaVersion !== SCHEMA) fail('対応していないバージョンのファイルです。');
  const g = o.goal;
  if (!g || typeof g !== 'object') fail('目標のデータがありません。');
  if (!isNum(g.baseSavings) || g.baseSavings < 0) fail('貯金額のデータが正しくありません。');
  if (!isNum(g.target) || g.target <= 0) fail('目標金額のデータが正しくありません。');
  if (!parseISO(g.deadline)) fail('目標日のデータが正しくありません。');
  if (!isNum(g.hourlyWage) || g.hourlyWage <= 0) fail('時給のデータが正しくありません。');
  const validDay = (v) => Number.isInteger(v) && v >= 1 && v <= 31;
  const closingDay = g.closingDay === undefined ? DEFAULT_CLOSING : g.closingDay;
  const payDay = g.payDay === undefined ? DEFAULT_PAYDAY : g.payDay;
  if (!validDay(closingDay)) fail('締め日のデータが正しくありません。');
  if (!validDay(payDay)) fail('支払日のデータが正しくありません。');
  if (!Array.isArray(o.shifts)) fail('勤務履歴のデータが正しくありません。');
  const adjIn = o.adjustments === undefined ? [] : o.adjustments;
  if (!Array.isArray(adjIn)) fail('貯金額の修正履歴が正しくありません。');
  if (o.shifts.length > MAX_ROWS || adjIn.length > MAX_ROWS) fail('データが大きすぎます。');

  const used = new Set();
  const uid = (v) => {
    let id = typeof v === 'string' ? v.replace(/[^\w-]/g, '').slice(0, 64) : '';
    if (!id || used.has(id)) id = newId();
    used.add(id);
    return id;
  };
  const str = (v) => (typeof v === 'string' ? v.slice(0, 40) : '');

  const shifts = o.shifts.map((s, i) => {
    if (!s || typeof s !== 'object') fail(`勤務履歴の${i + 1}件目が正しくありません。`);
    if (!parseISO(s.date)) fail(`勤務履歴の${i + 1}件目の日付が正しくありません。`);
    if (!Number.isInteger(s.minutes) || s.minutes < 1 || s.minutes > 1440) fail(`勤務履歴の${i + 1}件目の勤務時間が正しくありません。`);
    const wage = isNum(s.wage) && s.wage >= 0 ? s.wage : g.hourlyWage;
    const earned = isNum(s.earned) ? Math.round(s.earned) : earnedOf(s.minutes, wage);
    return { id: uid(s.id), date: s.date, minutes: s.minutes, wage, earned, at: str(s.at) };
  });
  const adjustments = adjIn.map((a, i) => {
    if (!a || typeof a !== 'object' || !parseISO(a.date) || !isNum(a.delta)) fail(`貯金額の修正履歴の${i + 1}件目が正しくありません。`);
    return { id: uid(a.id), date: a.date, delta: Math.round(a.delta), at: str(a.at) };
  });

  return {
    app: APP_ID,
    schemaVersion: SCHEMA,
    goal: {
      baseSavings: Math.round(g.baseSavings),
      target: Math.round(g.target),
      deadline: g.deadline,
      hourlyWage: g.hourlyWage,
      closingDay,
      payDay,
      createdAt: str(g.createdAt)
    },
    shifts,
    adjustments
  };
}

function load() {
  let raw = null;
  try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { storageOK = false; return null; }
  if (!raw) return null;
  try {
    return normalizeState(JSON.parse(raw));
  } catch (e) {
    try { localStorage.setItem(STORAGE_KEY + ':broken', raw); } catch (_) { /* ignore */ }
    return null;
  }
}
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); storageOK = true; }
  catch (e) { storageOK = false; }
  $('#storageWarn').hidden = storageOK;
}

/* ---------- 計算 ---------- */
function compute() {
  const g = state.goal;
  const mo = money(state);
  const savings = mo.cash;
  // 入金待ちのうち、目標日までに入金される分は「確定した収入」として差し引く
  const remaining = Math.max(0, g.target - savings - mo.pendingCounted);
  const remainingHours = remaining / g.hourlyWage;
  const t = now();
  const today = dayNum(t.y, t.m, t.d);
  const iso = todayISO();
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

/* ---------- 描画 ---------- */
function render() {
  const has = !!state;
  $('#setupView').hidden = has;
  $('#mainView').hidden = !has;
  $('#openSettings').hidden = !has;
  $('#storageWarn').hidden = storageOK;
  if (!has) {
    $('#sDeadline').min = todayISO();
    return;
  }
  renderSummary();
  renderNeed();
  renderWorked();
  renderHistory();
  renderFormMeta();
}

function renderSummary() {
  const g = state.goal;
  const mo = money(state);
  const sv = mo.cash;
  const pct = Math.max(0, Math.min(100, sv / g.target * 100));
  const pendPct = Math.max(0, Math.min(100 - pct, mo.pendingCounted / g.target * 100));
  $('#savingsAmount').textContent = yen(sv);
  $('#barFill').style.width = pct + '%';
  $('#barPending').style.width = pendPct + '%';
  const pl = $('#pendingLine');
  pl.hidden = mo.pending <= 0;
  if (mo.pending > 0) {
    const np = partsOfDay(mo.nextPay);
    pl.innerHTML = `入金待ち <b>${yen(mo.pending)}</b>（次の入金は${np.y !== now().y ? np.y + '年' : ''}${np.m}月${np.d}日）`;
  }
  $('#bar').setAttribute('aria-valuenow', String(Math.floor(pct)));
  $('#barPct').textContent = Math.floor(pct) + '%';
  $('#barTarget').textContent = '目標 ' + yen(g.target);
  const remain = Math.max(0, g.target - sv);
  $('#factRemain').textContent = remain > 0 ? yen(remain) : '達成';
  const dd = isoDay(g.deadline) - todayDay();
  $('#factDeadline').textContent = fmtDay(isoDay(g.deadline), true);
  $('#factDeadlineSub').textContent = dd > 0 ? `あと${dd}日` : dd === 0 ? '今日が期限です' : `${-dd}日過ぎています`;
}

const numBlock = (hours) =>
  `<p class="need-num"><span class="n">${fmtH(hours)}</span><span class="u">時間</span></p>`;

function renderNeed() {
  const c = compute();
  const el = $('#needBody');
  if (c.achieved) {
    el.innerHTML = c.cashReached
      ? '<p class="need-msg">目標金額に到達しました。</p><p class="note">次の目標は、設定から金額と日付を変えて続けられます。</p>'
      : '<p class="need-msg">入金待ちを合わせると、目標金額に届きます。</p><p class="note">これ以上働かなくても、入金が済めば目標金額に到達します。</p>';
    return;
  }
  if (c.expired) {
    const upto = c.lastWork === null
      ? '目標日までに入金される勤務期間がありません。'
      : `目標日（${fmtDay(c.deadline, true)}）までに入金されるのは${fmtDay(c.lastWork, true)}までの勤務分で、その期間はすでに終わっています。`;
    el.innerHTML =
      '<p class="need-msg">目標日までに入金される勤務期間が残っていません。</p>' +
      `<p class="note">${upto}目標金額まであと${yen(c.remaining)}（約${fmtH(c.remainingHours)}時間分）です。設定から目標日を後ろにずらしてください。</p>` +
      (c.lateEarned > 0 ? `<p class="note">目標日に間に合わない入金待ち（${yen(c.lateEarned)}）は、計算に含めていません。</p>` : '');
    return;
  }
  const sub = (p) => (p.days > 0 ? `あと${p.days}日（${fmtDay(p.end)}まで）` : '今週の残り日数はありません');
  const subMonth = (p) => (p.days > 0 ? `あと${p.days}日（${fmtDay(p.end)}まで）` : '今月の残り日数はありません');
  el.innerHTML =
    `<div class="need-hero"><p class="need-name">今週</p>${numBlock(c.week.hours)}<p class="need-sub">${sub(c.week)}</p></div>` +
    '<div class="need-pair">' +
      `<div><p class="need-name">今月</p>${numBlock(c.month.hours)}<p class="need-sub">${subMonth(c.month)}</p></div>` +
      `<div><p class="need-name">目標日まで</p>${numBlock(c.remainingHours)}<p class="need-sub">あと${c.daysLeft}日（${fmtDay(c.lastWork, true)}の勤務分まで）</p></div>` +
    '</div>' +
    (c.perDay > 24
      ? `<p class="note" style="color:var(--danger);font-weight:700">1日あたり約${fmtH(c.perDay)}時間が必要で、現実的なペースではありません。設定から目標日や金額を見直してください。</p>`
      : '') +
    `<p class="note">目標日（${fmtDay(c.deadline, true)}）までに入金されるのは、${fmtDay(c.lastWork, true)}までの勤務分です。この期間の残り日数で均等に割ると、1日あたり約${fmtH(c.perDay)}時間のペースです。今日の勤務を記録済みの場合は明日から数えます。</p>` +
    (c.lateEarned > 0 ? `<p class="note">目標日に間に合わない入金待ち（${yen(c.lateEarned)}）は、計算に含めていません。</p>` : '');
}

function renderWorked() {
  const t = now();
  const today = dayNum(t.y, t.m, t.d);
  const wkStart = today - ((t.dow + 6) % 7);
  const wkEnd = wkStart + 6;
  const mStart = dayNum(t.y, t.m, 1);
  const mEnd = monthEndDay(t.y, t.m);
  let w = 0, m = 0;
  for (const s of state.shifts) {
    const n = isoDay(s.date);
    if (n >= wkStart && n <= wkEnd) w += s.minutes;
    if (n >= mStart && n <= mEnd) m += s.minutes;
  }
  $('#workedStats').innerHTML = `<span>今週 <b>${fmtHM(w)}</b></span><span>今月 <b>${fmtHM(m)}</b></span>`;
}

function renderHistory() {
  const items = [
    ...state.shifts.map((s) => ({ kind: 'shift', ...s })),
    ...state.adjustments.map((a) => ({ kind: 'adj', ...a }))
  ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  const list = $('#historyList');
  if (!items.length) {
    list.innerHTML = '<li class="empty">まだ記録がありません。勤務が終わったら、上のフォームに勤務時間を入力してください。</li>';
    $('#moreBtn').hidden = true;
    return;
  }
  const shown = items.slice(0, historyLimit);
  const today = todayDay();
  list.innerHTML = shown.map((it) => {
    if (it.kind === 'shift') {
      const pd = payDayOf(it.date, state.goal);
      const pay = pd <= today ? '入金済み' : `${fmtDay(pd, partsOfDay(pd).y !== now().y)}に入金予定`;
      return `<li class="item">
          <p class="item-date">${fmtISO(it.date)}<span class="item-pay">${pay}</span></p>
          <p class="item-amt pos">+${yen(it.earned)}</p>
          <p class="item-detail">${fmtHM(it.minutes)}（時給 ${yen(it.wage)}）</p>
          <div class="item-actions">
            <button type="button" class="btn-text" data-act="edit" data-id="${it.id}">編集</button>
            <button type="button" class="btn-text danger" data-act="del" data-id="${it.id}">削除</button>
          </div></li>`;
    }
    const pos = it.delta >= 0;
    return `<li class="item">
          <p class="item-date">${fmtISO(it.date)}</p>
          <p class="item-amt ${pos ? 'pos' : 'neg'}">${pos ? '+' : ''}${yen(it.delta)}</p>
          <p class="item-detail">貯金額を修正</p>
          <div class="item-actions">
            <button type="button" class="btn-text danger" data-act="delAdj" data-id="${it.id}">削除</button>
          </div></li>`;
  }).join('');
  $('#moreBtn').hidden = items.length <= historyLimit;
}

function renderFormMeta() {
  const iso = todayISO();
  $('#shiftDate').max = iso;
  if (!editingId && ($('#shiftDate').value === '' || $('#shiftDate').value === defaultDate)) {
    $('#shiftDate').value = iso;
  }
  defaultDate = iso;
}

/* ---------- 勤務フォーム ---------- */
const optNum = (v) => (String(v).trim() === '' ? 0 : Number(v));

function formMinutes() {
  const h = optNum($('#shiftH').value);
  const m = optNum($('#shiftM').value);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return { error: '勤務時間は数字で入力してください。' };
  if (h < 0 || m < 0) return { error: '勤務時間は0以上で入力してください。' };
  if (m >= 60) return { error: '分は0〜59で入力してください。' };
  const min = Math.round(h * 60) + Math.round(m);
  if (min <= 0) return { error: '勤務時間を入力してください。' };
  if (min > 1440) return { error: '勤務時間は24時間以内で入力してください。' };
  return { min };
}

function updatePreview() {
  const el = $('#shiftPreview');
  const r = formMinutes();
  if (r.error || !state) { el.textContent = ''; return; }
  const editing = editingId ? state.shifts.find((s) => s.id === editingId) : null;
  const wage = editing ? editing.wage : state.goal.hourlyWage;
  el.textContent = `${fmtHM(r.min)} → +${yen(earnedOf(r.min, wage))}`;
}

function resetShiftForm() {
  editingId = null;
  $('#shiftDate').value = todayISO();
  defaultDate = todayISO();
  $('#shiftH').value = '';
  $('#shiftM').value = '';
  $('#shiftError').textContent = '';
  $('#shiftPreview').textContent = '';
  $('#formTitle').textContent = '勤務を記録';
  $('#shiftSubmit').textContent = '記録する';
  $('#shiftCancel').hidden = true;
}

function startEdit(id) {
  const s = state.shifts.find((x) => x.id === id);
  if (!s) return;
  editingId = id;
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

$('#shiftForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const err = $('#shiftError');
  const date = $('#shiftDate').value;
  if (!parseISO(date)) { err.textContent = '日付を選んでください。'; return; }
  if (isoDay(date) > todayDay()) { err.textContent = '今日より先の日付は記録できません。'; return; }
  const r = formMinutes();
  if (r.error) { err.textContent = r.error; return; }
  err.textContent = '';
  if (editingId) {
    const s = state.shifts.find((x) => x.id === editingId);
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

/* ---------- 履歴の操作 ---------- */
$('#historyList').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const id = b.dataset.id;
  if (b.dataset.act === 'edit') { startEdit(id); return; }
  if (b.dataset.act === 'del') {
    const s = state.shifts.find((x) => x.id === id);
    if (!s) return;
    const ok = await confirmDialog({
      title: 'この勤務記録を削除しますか？',
      message: `${fmtISO(s.date)}・${fmtHM(s.minutes)}（${yen(s.earned)}）を削除すると、この金額が貯金額・入金待ちから外れます。`,
      ok: '削除する', danger: true
    });
    if (!ok) return;
    state.shifts = state.shifts.filter((x) => x.id !== id);
    if (editingId === id) resetShiftForm();
    save(); render(); toast('削除しました');
  }
  if (b.dataset.act === 'delAdj') {
    const a = state.adjustments.find((x) => x.id === id);
    if (!a) return;
    const ok = await confirmDialog({
      title: 'この修正を取り消しますか？',
      message: `${fmtISO(a.date)}の貯金額の修正（${a.delta >= 0 ? '+' : ''}${yen(a.delta)}）を取り消すと、貯金額が元に戻ります。`,
      ok: '取り消す', danger: true
    });
    if (!ok) return;
    state.adjustments = state.adjustments.filter((x) => x.id !== id);
    save(); render(); toast('取り消しました');
  }
});
$('#moreBtn').addEventListener('click', () => { historyLimit += PAGE_SIZE; renderHistory(); });

/* ---------- 貯金額の修正 ---------- */
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
  if (!(v >= 0)) { $('#svError').textContent = '0以上の数字で入力してください。'; return; }
  const next = Math.round(v);
  const delta = next - Math.round(savingsNow(state));
  dlgSavings.close();
  if (delta === 0) return;
  state.adjustments.push({ id: newId(), date: todayISO(), delta, at: new Date().toISOString() });
  save(); render(); toast('貯金額を修正しました');
});

/* ---------- 目標の検証（初回設定・設定画面で共通） ---------- */
function readNum(el) {
  const v = el.value.trim();
  if (v === '') return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}
function goalError({ target, deadline, wage, closing, payDay }, checkDeadline) {
  if (!(target > 0)) return '目標金額は1円以上の数字で入力してください。';
  if (!parseISO(deadline)) return '目標を達成する日を選んでください。';
  if (checkDeadline && isoDay(deadline) < todayDay()) return '目標日は今日以降の日付にしてください。';
  if (!(wage > 0)) return '時給は1円以上の数字で入力してください。';
  const okDay = (v) => Number.isInteger(v) && v >= 1 && v <= 31;
  if (!okDay(closing)) return '締め日は1〜31の整数で入力してください（月末は31）。';
  if (!okDay(payDay)) return '支払日は1〜31の整数で入力してください。';
  return '';
}

/* ---------- 初回設定 ---------- */
$('#setupForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const cur = readNum($('#sCurrent'));
  const target = readNum($('#sTarget'));
  const wage = readNum($('#sWage'));
  const deadline = $('#sDeadline').value;
  const err = $('#setupError');
  if (!(cur >= 0)) { err.textContent = 'いまの貯金は0円以上の数字で入力してください。'; return; }
  const closing = readNum($('#sClosing'));
  const payDay = readNum($('#sPayDay'));
  const ge = goalError({ target, deadline, wage, closing, payDay }, true);
  if (ge) { err.textContent = ge; return; }
  if (!(target > cur)) { err.textContent = '目標金額は、いまの貯金より大きくしてください。'; return; }
  err.textContent = '';
  state = {
    app: APP_ID, schemaVersion: SCHEMA,
    goal: {
      baseSavings: Math.round(cur), target: Math.round(target),
      deadline, hourlyWage: wage, closingDay: closing, payDay, createdAt: new Date().toISOString()
    },
    shifts: [], adjustments: []
  };
  save();
  historyLimit = PAGE_SIZE;
  resetShiftForm();
  render();
  window.scrollTo(0, 0);
});

/* ---------- 設定 ---------- */
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
  const target = readNum($('#gTarget'));
  const wage = readNum($('#gWage'));
  const deadline = $('#gDeadline').value;
  const closing = readNum($('#gClosing'));
  const payDay = readNum($('#gPayDay'));
  const changed = deadline !== state.goal.deadline;
  const ge = goalError({ target, deadline, wage, closing, payDay }, changed);
  if (ge) { $('#goalError').textContent = ge; return; }
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

/* ---------- エクスポート / インポート ---------- */
$('#exportBtn').addEventListener('click', () => {
  const data = { ...state, exportedAt: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `savings-pace-${todayISO()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  dlgSettings.close();
  toast('エクスポートしました');
});

const fileInput = $('#fileInput');
$('#importBtn').addEventListener('click', () => fileInput.click());
$('#setupImport').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
  const file = fileInput.files && fileInput.files[0];
  fileInput.value = '';
  if (!file) return;
  dlgSettings.close();
  let next;
  try {
    let obj;
    try { obj = JSON.parse(await file.text()); }
    catch (_) { throw new Error('JSONとして読み取れませんでした。'); }
    next = normalizeState(obj);
  } catch (err) {
    toast(err.message || '読み込みに失敗しました。', true);
    return;
  }
  await adoptState(next);
});

// 読み込んだデータを現在のデータと入れ替える（JSON・QR共通）
async function adoptState(next) {
  if (state) {
    const ok = await confirmDialog({
      title: 'データを置き換えますか？',
      message: `いまのデータは消え、読み込んだ内容（勤務記録${next.shifts.length}件、目標金額${yen(next.goal.target)}）に置き換わります。`,
      ok: '置き換える', danger: true
    });
    if (!ok) return false;
  }
  state = next;
  save();
  historyLimit = PAGE_SIZE;
  resetShiftForm();
  render();
  toast('インポートしました');
  return true;
}

$('#resetBtn').addEventListener('click', async () => {
  const ok = await confirmDialog({
    title: 'すべてのデータを削除しますか？',
    message: 'この端末に保存された目標と勤務履歴を消します。元に戻せません。必要な場合は先にエクスポートしてください。',
    ok: '削除する', danger: true
  });
  if (!ok) return;
  try { localStorage.removeItem(STORAGE_KEY); } catch (_) { /* ignore */ }
  state = null;
  dlgSettings.close();
  resetShiftForm();
  ['#sCurrent', '#sTarget', '#sWage', '#sDeadline'].forEach((s) => { $(s).value = ''; });
  $('#sClosing').value = DEFAULT_CLOSING;
  $('#sPayDay').value = DEFAULT_PAYDAY;
  render();
  toast('削除しました');
});


/* ---------- QRコード（書き出し／読み込み） ---------- */
// 形式: SP1.<セッションID>.<番号>.<総数>.<データ>  （データ = 圧縮したコンパクトJSONをbase64url化したもの）
const QR_CHUNK = 380;      // 1枚あたりの文字数（小さいほど読み取りやすい）
const QR_MAX_CHUNKS = 200;
const QR_RE = /^SP1\.([0-9a-z]{4,8})\.(\d{1,3})\.(\d{1,3})\.([A-Za-z0-9_-]+)$/;
const hasCompression = typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

function toB64u(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64u(str) {
  const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function runStream(stream, bytes) {
  const w = stream.writable.getWriter();
  w.write(bytes).catch(() => {});
  w.close().catch(() => {});
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

const secOf = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? Math.floor(t / 1000) : 0; };
const isoOfDay = (n) => { const p = partsOfDay(n); return `${p.y}-${pad(p.m)}-${pad(p.d)}`; };

// 状態 → 短い配列形式。日付は日数の差分、入力時刻とIDは省く（読み込み時に順序を保って振り直す）
function toCompact(s) {
  const g = s.goal;
  const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.at < b.at ? -1 : a.at > b.at ? 1 : 0);
  let prev = 0;
  const rows = [...s.shifts].sort(byDate).map((x) => {
    const d = isoDay(x.date);
    const row = [d - prev, x.minutes, x.wage];
    prev = d;
    if (x.earned !== earnedOf(x.minutes, x.wage)) row.push(x.earned);
    return row;
  });
  prev = 0;
  const adj = [...s.adjustments].sort(byDate).map((x) => {
    const d = isoDay(x.date);
    const row = [d - prev, x.delta];
    prev = d;
    return row;
  });
  return {
    v: 1,
    g: [g.baseSavings, g.target, isoDay(g.deadline), g.hourlyWage, g.closingDay, g.payDay, secOf(g.createdAt)],
    s: rows, a: adj
  };
}
function fromCompact(c) {
  const bad = () => { throw new Error('QRのデータが正しくありません。'); };
  if (!c || c.v !== 1 || !Array.isArray(c.g) || !Array.isArray(c.s) || !Array.isArray(c.a)) bad();
  const [baseSavings, target, deadlineDay, hourlyWage, closingDay, payDay, created] = c.g;
  const dayOk = (n) => Number.isInteger(n) && n > 0 && n < 100000;
  if (!dayOk(deadlineDay)) bad();
  const baseAt = (isNum(created) && created > 0 ? created : 1577836800) * 1000;
  let prev = 0;
  const shifts = c.s.map((r, i) => {
    if (!Array.isArray(r)) bad();
    prev += r[0];
    if (!dayOk(prev)) bad();
    return {
      date: isoOfDay(prev), minutes: r[1], wage: r[2],
      earned: isNum(r[3]) ? r[3] : earnedOf(r[1], r[2]),
      at: new Date(baseAt + i * 1000).toISOString()
    };
  });
  prev = 0;
  const adjustments = c.a.map((r, i) => {
    if (!Array.isArray(r)) bad();
    prev += r[0];
    if (!dayOk(prev)) bad();
    return { date: isoOfDay(prev), delta: r[1], at: new Date(baseAt + (500000 + i) * 1000).toISOString() };
  });
  return {
    app: APP_ID, schemaVersion: SCHEMA,
    goal: {
      baseSavings, target, deadline: isoOfDay(deadlineDay), hourlyWage, closingDay, payDay,
      createdAt: isNum(created) && created > 0 ? new Date(created * 1000).toISOString() : ''
    },
    shifts, adjustments
  };
}

async function encodePayload(s) {
  const json = new TextEncoder().encode(JSON.stringify(toCompact(s)));
  if (hasCompression) return 'z' + toB64u(await runStream(new CompressionStream('deflate'), json));
  return 'j' + toB64u(json);
}
async function decodePayload(p) {
  let bytes;
  try {
    const body = fromB64u(p.slice(1));
    if (p[0] === 'j') bytes = body;
    else if (p[0] === 'z') {
      if (!hasCompression) throw new Error('このブラウザは、圧縮されたQRデータの展開に対応していません。');
      bytes = await runStream(new DecompressionStream('deflate'), body);
    } else throw new Error('QRのデータ形式が正しくありません。');
  } catch (e) {
    throw new Error(/^(このブラウザ|QRのデータ形式)/.test(e.message) ? e.message : 'QRのデータを展開できませんでした。');
  }
  let obj;
  try { obj = JSON.parse(new TextDecoder().decode(bytes)); }
  catch (_) { throw new Error('QRのデータを読み取れませんでした。'); }
  return fromCompact(obj);
}
function makeChunks(payload) {
  const total = Math.ceil(payload.length / QR_CHUNK);
  const sid = Math.random().toString(36).slice(2, 8).padEnd(6, '0');
  const out = [];
  for (let i = 0; i < total; i++) out.push(`SP1.${sid}.${i + 1}.${total}.${payload.slice(i * QR_CHUNK, (i + 1) * QR_CHUNK)}`);
  return out;
}

/* --- 書き出し --- */
const dlgQrExport = $('#dlgQrExport');
let qrChunks = [], qrIdx = 0, qrTimer = null;

function qrSvg(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount(), quiet = 4, size = n + quiet * 2;
  let d = '';
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (!qr.isDark(r, c)) { c++; continue; }
      let len = 1;
      while (c + len < n && qr.isDark(r, c + len)) len++;
      d += `M${c + quiet} ${r + quiet}h${len}v1h-${len}z`;
      c += len;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
function showQr() {
  $('#qrView').innerHTML = qrSvg(qrChunks[qrIdx]);
  const n = qrChunks.length;
  $('#qrCount').textContent = n > 1 ? `${qrIdx + 1} / ${n}` : '1枚だけです';
  $('#qrView').setAttribute('aria-label', `データのQRコード（${qrIdx + 1}枚目、全${n}枚）`);
}
function stopQrPlay() {
  clearInterval(qrTimer);
  qrTimer = null;
  $('#qrPlay').textContent = '再生';
}
function startQrPlay() {
  if (qrChunks.length < 2) return;
  clearInterval(qrTimer);
  qrTimer = setInterval(() => { qrIdx = (qrIdx + 1) % qrChunks.length; showQr(); }, 1600);
  $('#qrPlay').textContent = '一時停止';
}
async function openQrExport() {
  dlgSettings.close();
  try {
    qrChunks = makeChunks(await encodePayload(state));
    if (qrChunks.length > QR_MAX_CHUNKS) throw new Error('データが大きすぎてQRにできません。JSONで書き出してください。');
    qrIdx = 0;
    showQr();
  } catch (e) {
    toast(e.message || 'QRコードを作れませんでした。', true);
    return;
  }
  const n = qrChunks.length;
  $('#qrControls').hidden = n < 2;
  $('#qrHint').textContent = n < 2
    ? '読み込む端末で「QRで読み込み」を開き、このQRにカメラを向けてください。'
    : `読み込む端末で「QRで読み込み」を開き、カメラを向けてください。QRは全${n}枚で、自動で切り替わります。すべて読み取れるまで、この画面を開いたままにしてください。` +
      (n > 20 ? '枚数が多いときは、JSONでの書き出しのほうが確実です。' : '');
  dlgQrExport.showModal();
  if (reducedMotion()) stopQrPlay(); else startQrPlay();
}
$('#qrPrev').addEventListener('click', () => { stopQrPlay(); qrIdx = (qrIdx - 1 + qrChunks.length) % qrChunks.length; showQr(); });
$('#qrNext').addEventListener('click', () => { stopQrPlay(); qrIdx = (qrIdx + 1) % qrChunks.length; showQr(); });
$('#qrPlay').addEventListener('click', () => { if (qrTimer) stopQrPlay(); else startQrPlay(); });
dlgQrExport.addEventListener('close', () => { clearInterval(qrTimer); qrTimer = null; $('#qrView').innerHTML = ''; });
$('#qrExportBtn').addEventListener('click', openQrExport);

/* --- 読み込み --- */
const dlgQrImport = $('#dlgQrImport');
let scan = null;        // { sid, total, parts: Map(番号 -> データ) }
let camStream = null, scanTimer = null;
const scanCanvas = document.createElement('canvas');

function setQrStatus(msg, isErr = false) {
  const el = $('#qrStatus');
  el.textContent = msg;
  el.classList.toggle('err', isErr);
}
function renderDots() {
  const el = $('#qrDots');
  if (!scan) { el.innerHTML = ''; return; }
  let h = '';
  for (let i = 1; i <= scan.total; i++) h += `<i class="${scan.parts.has(i) ? 'on' : ''}"></i>`;
  el.innerHTML = h;
}
function stopCamera() {
  clearTimeout(scanTimer);
  scanTimer = null;
  if (camStream) camStream.getTracks().forEach((t) => t.stop());
  camStream = null;
  const v = $('#qrVideo');
  v.pause && v.pause();
  v.srcObject = null;
}

// 読み取った1枚分の文字列を取り込む。QRアプリのものでなければ false
function feedQr(text) {
  const m = QR_RE.exec(String(text).trim());
  if (!m) return false;
  const sid = m[1], idx = +m[2], total = +m[3], part = m[4];
  if (idx < 1 || idx > total || total > QR_MAX_CHUNKS) return false;
  if (!scan || scan.sid !== sid || scan.total !== total) scan = { sid, total, parts: new Map() };
  if (!scan.parts.has(idx)) {
    scan.parts.set(idx, part);
    if (navigator.vibrate) navigator.vibrate(30);
    renderDots();
    setQrStatus(total > 1 ? `読み取り中… ${scan.parts.size} / ${total}` : '読み取りました');
  }
  if (scan.parts.size === scan.total) finishScan();
  return true;
}

async function finishScan() {
  const sc = scan;
  scan = null;
  stopCamera();
  const payload = Array.from({ length: sc.total }, (_, i) => sc.parts.get(i + 1)).join('');
  let next;
  try {
    next = normalizeState(await decodePayload(payload));
  } catch (e) {
    setQrStatus((e.message || '読み込みに失敗しました。') + 'もう一度読み取ってください。', true);
    renderDots();
    startCamera(true);
    return;
  }
  dlgQrImport.close();
  await adoptState(next);
}

function scanTick() {
  if (!camStream) return;
  const v = $('#qrVideo');
  if (v.readyState >= 2 && v.videoWidth) {
    const sc = Math.min(1, 960 / v.videoWidth);
    const w = Math.round(v.videoWidth * sc), h = Math.round(v.videoHeight * sc);
    scanCanvas.width = w;
    scanCanvas.height = h;
    const cx = scanCanvas.getContext('2d', { willReadFrequently: true });
    cx.drawImage(v, 0, 0, w, h);
    try {
      const img = cx.getImageData(0, 0, w, h);
      const code = jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' });
      if (code) feedQr(code.data);
    } catch (_) { /* 1フレームの失敗では止めない */ }
  }
  if (camStream) scanTimer = setTimeout(scanTick, 120);
}

async function startCamera(keepStatus = false) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setQrStatus('このブラウザではカメラを使えません。「画像から読み込む」をお使いください。', true);
    return;
  }
  try {
    camStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false
    });
    const v = $('#qrVideo');
    v.srcObject = camStream;
    await v.play();
    if (!keepStatus && !scan) setQrStatus('QRコードにカメラを向けてください。');
  } catch (e) {
    stopCamera();
    setQrStatus(
      e && e.name === 'NotAllowedError'
        ? 'カメラの使用が許可されていません。ブラウザの設定で許可するか、「画像から読み込む」をお使いください。'
        : 'カメラを起動できませんでした。「画像から読み込む」をお使いください。', true);
    return;
  }
  scanTick();
}

function openQrImport() {
  dlgSettings.close();
  scan = null;
  renderDots();
  setQrStatus('カメラを起動しています…');
  dlgQrImport.showModal();
  startCamera();
}
dlgQrImport.addEventListener('close', () => { stopCamera(); scan = null; });
$('#qrImportBtn').addEventListener('click', openQrImport);
$('#setupQr').addEventListener('click', openQrImport);

// 画像（スクリーンショットなど）からの読み取り
async function decodeImageFile(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => rej(new Error('image'));
      im.src = url;
    });
    const cx = scanCanvas.getContext('2d', { willReadFrequently: true });
    for (const maxSide of [2000, 1000, 640]) {
      const sc = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * sc)), h = Math.max(1, Math.round(img.naturalHeight * sc));
      scanCanvas.width = w;
      scanCanvas.height = h;
      cx.drawImage(img, 0, 0, w, h);
      const code = jsQR(cx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'attemptBoth' });
      if (code) return code.data;
    }
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}
$('#qrPickImage').addEventListener('click', () => $('#qrImageInput').click());
$('#qrImageInput').addEventListener('change', async (e) => {
  const files = Array.from(e.target.files || []);
  e.target.value = '';
  if (!files.length) return;
  let found = 0;
  for (const f of files) {
    setQrStatus('画像を読み取っています…');
    let text = null;
    try { text = await decodeImageFile(f); } catch (_) { /* 次の画像へ */ }
    if (text && feedQr(text)) found++;
    if (!dlgQrImport.open) return; // 読み取り完了で閉じた
  }
  setQrStatus(
    found ? `${found}枚のQRを読み取りました。` + (scan && scan.parts.size < scan.total ? `あと${scan.total - scan.parts.size}枚です。` : '')
          : '画像からQRコードを読み取れませんでした。QR全体が写っているか確認してください。',
    !found);
});

/* ---------- 共通UI ---------- */
function confirmDialog({ title, message, ok = 'OK', danger = false }) {
  return new Promise((resolve) => {
    const d = $('#dlgConfirm');
    const okBtn = $('#cfOk');
    $('#cfTitle').textContent = title;
    $('#cfMsg').textContent = message;
    okBtn.textContent = ok;
    okBtn.className = 'btn ' + (danger ? 'danger-solid' : 'primary');
    let result = false;
    const onOk = () => { result = true; d.close(); };
    const onClose = () => {
      okBtn.removeEventListener('click', onOk);
      d.removeEventListener('close', onClose);
      resolve(result);
    };
    okBtn.addEventListener('click', onOk);
    d.addEventListener('close', onClose);
    d.showModal();
  });
}
$('#cfCancel').addEventListener('click', () => $('#dlgConfirm').close());

document.addEventListener('click', (e) => {
  const closer = e.target.closest('[data-close]');
  if (closer) { closer.closest('dialog').close(); return; }
  if (e.target instanceof HTMLDialogElement) e.target.close(); // 背景クリックで閉じる
});

let toastTimer;
function toast(msg, isErr = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('err', isErr);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), isErr ? 5000 : 2400);
}

/* ---------- 起動 ---------- */
try { localStorage.setItem('__probe', '1'); localStorage.removeItem('__probe'); } catch (e) { storageOK = false; }
state = load();
resetShiftForm();
render();

// 日付をまたいで開きっぱなしでも、戻ってきたときに計算し直す
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
// 別タブでの変更を反映する
window.addEventListener('storage', (e) => {
  if (e.key === STORAGE_KEY || e.key === null) {
    state = load();
    editingId = null;
    render();
  }
});
