// 参照用テスト（旧 index.html に対する jsdom ベースの挙動確認）。
// Vitest へ移植する際のテストケース集として使う。実行: pnpm add -D jsdom jsqr && node pay-cycle.reference.cjs
const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'legacy', 'index.html'), 'utf8').replace(/<link[^>]*fonts[^>]*>/g, '');
const FIXED = new Date(2026, 9, 3, 12, 0, 0).getTime(); // 2026-10-03 (Sat)
let fails = 0;
const ok = (c, m, extra) => { console.log((c ? 'PASS ' : 'FAIL ') + m + (c ? '' : '  -> ' + extra)); if (!c) fails++; };

function boot(state, now = FIXED) {
  return new JSDOM(html, { runScripts: 'dangerously', url: 'https://x.example/', pretendToBeVisual: true,
    beforeParse(w) {
      const R = w.Date;
      class FD extends R { constructor(...a) { if (a.length === 0) super(now); else super(...a); } static now() { return now; } }
      w.Date = FD;
      w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
      w.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); this.dispatchEvent(new w.Event('close')); };
      w.HTMLElement.prototype.scrollIntoView = () => {};
      w.matchMedia = () => ({ matches: false });
      if (state) w.localStorage.setItem('savings-pace:v1', JSON.stringify(state));
    } }).window;
}
const base = (goal, shifts = [], adjustments = []) => ({ app: 'savings-pace', schemaVersion: 1,
  goal: Object.assign({ baseSavings: 50000, target: 300000, deadline: '2027-03-31', hourlyWage: 1000, closingDay: 31, payDay: 25, createdAt: '' }, goal),
  shifts, adjustments });
const txt = (w, s) => w.document.querySelector(s).textContent.replace(/\s+/g, ' ');
const sh = (date, minutes, wage = 1000) => ({ id: 's' + date, date, minutes, wage, earned: Math.round(minutes * wage / 60), at: date });

// 1) deadline 3/31 -> last counted work day = Feb 28 (pay Mar 25 <= 3/31; March work paid Apr 25)
let w = boot(base({}));
let need = txt(w, '#needBody');
console.log(need);
ok(need.includes('2027年2月28日の勤務分まで'), 'deadline 3/31 -> counts work up to 2/28');
ok(need.includes('あと149日'), '149 days (10/3..2/28)');
ok(need.includes('今週3.4時間'), 'week = 250h*2/149 = 3.4h', need);
ok(need.includes('今月48.7時間'), 'month = 250h*29/149 = 48.7h', need);

// 2) deadline 3/20 -> payday Mar 25 is after the deadline, so only Jan 31 and earlier count
w = boot(base({ deadline: '2027-03-20' }));
need = txt(w, '#needBody');
ok(need.includes('2027年1月31日の勤務分まで'), 'deadline 3/20 -> counts work up to 1/31', need);

// 3) deadline exactly on payday (3/25) -> Feb work counts
w = boot(base({ deadline: '2027-03-25' }));
ok(txt(w, '#needBody').includes('2027年2月28日の勤務分まで'), 'deadline on payday includes that cycle');

// 4) shift today is pending (pay 11/25), not cash; counts toward remaining
w = boot(base({}, [sh('2026-10-03', 300)])); // 5h = 5000
ok(txt(w, '#savingsAmount') === '¥50,000', 'today shift not in cash yet', txt(w, '#savingsAmount'));
ok(txt(w, '#pendingLine').includes('¥5,000') && txt(w, '#pendingLine').includes('11月25日'), 'pending shown with Nov 25', txt(w, '#pendingLine'));
need = txt(w, '#needBody');
ok(need.includes('あと148日'), 'start from tomorrow after logging today', need); // 10/4..2/28
ok(need.includes('目標日まで245時間'), 'total remaining = 245h (pending counted)', need);
ok(txt(w, '#historyList').includes('11月25日に入金予定'), 'history shows pay date');

// 5) shift paid already: Aug 31 closing -> Sep 25 paid; Sep work paid Oct 25 (pending)
w = boot(base({}, [sh('2026-08-20', 600), sh('2026-09-10', 600)]));
ok(txt(w, '#savingsAmount') === '¥60,000', 'Aug shift paid on 9/25 -> in cash', txt(w, '#savingsAmount'));
ok(txt(w, '#pendingLine').includes('10月25日'), 'Sep shift pending until 10/25', txt(w, '#pendingLine'));
ok(txt(w, '#historyList').includes('入金済み'), 'paid label shown');

// 6) late shift not counted toward goal: deadline 10/20, shift on 10/3 pays 11/25 > deadline
w = boot(base({ deadline: '2026-10-20', target: 80000 }, [sh('2026-10-03', 600)]));
need = txt(w, '#needBody');
console.log(need);
ok(need.includes('計算に含めていません'), 'late pending excluded & noted');

// 7) pending makes goal reachable
w = boot(base({ target: 55000 }, [sh('2026-10-03', 300)]));
ok(txt(w, '#needBody').includes('入金待ちを合わせると'), 'achieved with pending', txt(w, '#needBody'));

// 8) closing day 15 / pay day 5: 10/3 work -> closes 10/15 -> paid 11/5; 10/20 work -> closes 11/15 -> paid 12/5
w = boot(base({ closingDay: 15, payDay: 5 }, [sh('2026-10-03', 60), sh('2026-09-20', 60)]));
const pl = txt(w, '#pendingLine');
ok(pl.includes('11月5日'), 'closing 15 / pay 5 -> 10/3 work paid 11/5', pl);
// Sep 20 work -> closes 10/15 -> paid 11/5; Aug 10 work -> closes 8/15 -> paid 9/5
w = boot(base({ closingDay: 15, payDay: 5 }, [sh('2026-08-10', 60)]));
ok(txt(w, '#savingsAmount') === '¥51,000', 'Aug 10 work paid 9/5 (already)', txt(w, '#savingsAmount'));

// 9) setup flow has defaults 31/25 and stores them; settings round-trip; old export w/o fields defaults
w = boot(null);
ok(w.document.querySelector('#sClosing').value === '31' && w.document.querySelector('#sPayDay').value === '25', 'setup defaults 31 / 25');
const f = (s, v) => { w.document.querySelector(s).value = v; };
f('#sCurrent', '10000'); f('#sTarget', '100000'); f('#sWage', '1100'); f('#sDeadline', '2027-01-31');
w.document.querySelector('#setupForm').dispatchEvent(new w.Event('submit', { cancelable: true, bubbles: true }));
let st = JSON.parse(w.localStorage.getItem('savings-pace:v1'));
ok(st.goal.closingDay === 31 && st.goal.payDay === 25, 'stored pay cycle');
f('#sClosing', '0');
const legacy = base({}); delete legacy.goal.closingDay; delete legacy.goal.payDay;
w = boot(legacy);
st = JSON.parse(w.localStorage.getItem('savings-pace:v1'));
ok(!w.document.querySelector('#mainView').hidden, 'legacy state (no pay fields) still loads');

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exitCode = fails ? 1 : 0;
