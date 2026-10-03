import qrcode from 'qrcode-generator';
import jsQR from 'jsqr';
import './styles/main.css';
import { parseISO, isoDay, partsOfDay, dayNum, monthEndDay } from './core/dates.js';
import { now, todayISO, todayDay } from './core/clock.js';
import { DEFAULT_CLOSING, DEFAULT_PAYDAY, payDayOf } from './core/payCycle.js';
import { yen, fmtH, fmtHM, fmtDay, fmtISO as fmtISOIn } from './core/format.js';
import { earnedOf, money } from './core/money.js';
import { compute } from './core/compute.js';
import { APP_ID, SCHEMA, newId, normalizeState } from './core/schema.js';
import { readNum, goalError, formMinutes } from './core/validation.js';
import { QR_MAX_CHUNKS, QR_RE, encodePayload, decodePayload, makeChunks } from './core/qrCodec.js';

const STORAGE_KEY = 'savings-pace:v1';
const PAGE_SIZE = 20;

const $ = (sel, root = document) => root.querySelector(sel);
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const fmtISO = (s) => fmtISOIn(s, now().y);

/* ---------- 状態 ---------- */
let state = null;
let editingId = null;
let historyLimit = PAGE_SIZE;
let storageOK = true;
let defaultDate = '';

const savingsNow = (s) => money(s, todayDay()).cash;

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
  const mo = money(state, todayDay());
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
  const c = compute(state, now());
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
function updatePreview() {
  const el = $('#shiftPreview');
  const r = formMinutes($('#shiftH').value, $('#shiftM').value);
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
  const r = formMinutes($('#shiftH').value, $('#shiftM').value);
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

/* ---------- 初回設定 ---------- */
$('#setupForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const cur = readNum($('#sCurrent').value);
  const target = readNum($('#sTarget').value);
  const wage = readNum($('#sWage').value);
  const deadline = $('#sDeadline').value;
  const err = $('#setupError');
  if (!(cur >= 0)) { err.textContent = 'いまの貯金は0円以上の数字で入力してください。'; return; }
  const closing = readNum($('#sClosing').value);
  const payDay = readNum($('#sPayDay').value);
  const ge = goalError({ target, deadline, wage, closing, payDay }, true, todayDay());
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
  const target = readNum($('#gTarget').value);
  const wage = readNum($('#gWage').value);
  const deadline = $('#gDeadline').value;
  const closing = readNum($('#gClosing').value);
  const payDay = readNum($('#gPayDay').value);
  const changed = deadline !== state.goal.deadline;
  const ge = goalError({ target, deadline, wage, closing, payDay }, changed, todayDay());
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
