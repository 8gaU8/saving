import { $ } from './dom.js';
import { isoDay, partsOfDay, dayNum, monthEndDay } from '../core/dates.js';
import { now, todayISO, todayDay } from '../core/clock.js';
import { payDayOf } from '../core/payCycle.js';
import { yen, fmtH, fmtHM, fmtDay, fmtISO as fmtISOIn } from '../core/format.js';
import { money } from '../core/money.js';
import { compute } from '../core/compute.js';
import { storageOK } from '../store/storage.js';
import { state, persist } from '../store/state.js';
import { ui } from './uiState.js';

export const fmtISO = (s) => fmtISOIn(s, now().y);

// 保存して、保存できなければ警告バナーを出す
export function save() {
  persist();
  $('#storageWarn').hidden = storageOK;
}

export function render() {
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

export function renderHistory() {
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
  const shown = items.slice(0, ui.historyLimit);
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
  $('#moreBtn').hidden = items.length <= ui.historyLimit;
}

function renderFormMeta() {
  const iso = todayISO();
  $('#shiftDate').max = iso;
  if (!ui.editingId && ($('#shiftDate').value === '' || $('#shiftDate').value === ui.defaultDate)) {
    $('#shiftDate').value = iso;
  }
  ui.defaultDate = iso;
}
