# 貯金ペース — Claude Code 引き継ぎ資料

単一の `index.html`（約1,560行）で動いている Web アプリを、**pnpm + Vite によるモジュール分割構成**へ移行するための資料です。
作成日: 2026-10-03 / 対象: `legacy/index.html`（動作確認済みの現行版）

---

## 0. 最初に読むこと（TL;DR）

| 項目 | 内容 |
|---|---|
| 目的 | 単一 HTML からの脱却。pnpm で依存管理し、Vite で分割 JS/CSS をビルドして GitHub Pages に配備する |
| 原則 | **挙動を一切変えないリファクタリング**。機能追加・仕様変更・見た目変更はしない |
| 正解データ | `legacy/index.html`（旧版）と `fixtures/`（旧版が実際に出力した JSON / QR / 画面テキスト） |
| 最大の落とし穴 | ① localStorage キー `savings-pace:v1` とスキーマを変えない ② 日付計算（給与サイクル）を壊さない ③ 配備 URL を変えない（変えるとユーザーのデータが見えなくなる） |
| 進め方 | **UI に触る前に、純粋ロジックを `core/` に切り出して Vitest で固める**（§7 のフェーズ順を守る） |

### この資料のフォルダ構成

```
handoff/
├─ HANDOFF.md                       ← 本書
├─ CLAUDE.md                        ← リポジトリ直下に置く作業ルール（Claude Code が自動で読む）
├─ legacy/index.html                ← 移行元（全機能入り・単一ファイル・ライブラリはインライン）
├─ fixtures/
│  ├─ sample-state.json             ← localStorage に入る形式のサンプル（給与サイクルあり）
│  ├─ sample-state.no-paycycle.json ← 給与サイクル項目なしの旧形式（読み込めること）
│  ├─ sample-export.json            ← JSON エクスポート形式（exportedAt 付き）
│  ├─ sample-qr-chunks.json         ← 旧版が出力した QR の文字列（decode できること）
│  ├─ sample-qr-expected.json       ← 上記 QR を読み込んだ後の状態（id/at を除く）
│  └─ sample-rendered.golden.json   ← 時計を 2026-10-03 12:00 に固定したときの画面テキスト
└─ reference-tests/
   ├─ pay-cycle.reference.cjs       ← 旧版に対する jsdom テスト（給与サイクル・必要時間）
   └─ qr-roundtrip.reference.cjs    ← 旧版に対する jsdom テスト（QR 書き出し→実デコード→読み込み）
```

`reference-tests/*.cjs` は **Vitest へ移植するためのテストケース集**です。旧版に対して `node` で単体実行でき（`pnpm add -D jsdom jsqr` が必要）、全件 PASS を確認済みです。

---

## 1. アプリの概要

アルバイト等の時給労働で目標の貯金額に届くために、**今週・今月・目標日までに何時間働けばよいか**を表示する Web アプリ。サーバーなし・データは localStorage のみ。UI は日本語のみ。

### 機能一覧（すべて維持すること）

1. **初回設定**: 現在の貯金 / 目標金額 / 目標達成日 / 時給 / 給与の締め日（既定 31=月末）/ 支払日（翌月、既定 25）
2. **勤務の記録**: 日付 + 勤務時間（時間・分）。記録時に入金予定額をプレビュー。履歴から編集・削除
3. **貯金額の修正**: いつでも実際の残高に書き換え可能。差額は「修正」として履歴に残る（削除で取り消し可）
4. **必要時間の表示**: 今週 / 今月 / 目標日まで。1日あたりのペース、24時間超の警告、達成・期限切れの各状態
5. **給与サイクル**: 働いた分は入金日まで貯金に入らず「入金待ち」。目標日までに入金されない勤務は計算対象外
6. **設定画面**: 目標金額・目標日・時給・締め日・支払日の編集、全データ削除
7. **JSON エクスポート / インポート**: 別端末で同じ状態を再現
8. **QR エクスポート / インポート**: 圧縮して複数枚の QR に分割。カメラ連続読み取り、画像（スクリーンショット）からの読み取りにも対応
9. **レスポンシブ / ダークモード / `prefers-reduced-motion` 対応**、他タブでの変更の同期、日付またぎ時の再計算

### 現行版の規模と構成

`legacy/index.html` は次の順で並んでいる。

| 位置 | 内容 |
|---|---|
| `<style>` | 約 222 行。CSS 変数でライト/ダーク両対応 |
| HTML 本体 | `#setupView`（初回設定）/ `#mainView`（メイン）/ 5つの `<dialog>`（`dlgSavings` `dlgSettings` `dlgQrExport` `dlgQrImport` `dlgConfirm`）/ トースト |
| `<script>` 1つ目 | `qrcode-generator 2.0.4`（MIT）の minify 版。グローバル `qrcode` |
| `<script>` 2つ目 | `jsQR 1.4.0`（Apache-2.0）の minify 版。グローバル `jsQR` |
| `<script>` 3つ目 | **アプリ本体**（IIFE、約 1,056 行）。以降「メインスクリプト」と呼ぶ |

> 以降の「旧 L123」は、メインスクリプトの先頭を 1 行目としたときの行番号。セクションコメント（`/* ---------- … ---------- */`）で検索すると確実。

---

## 2. ゴールと非ゴール

### ゴール
- `pnpm install` / `pnpm dev` / `pnpm build` / `pnpm test` が動く
- JS を ES Modules に分割し、CSS も分割。`index.html` はマークアップのみ（インライン `<script>` / `<style>` なし）
- QR ライブラリは **npm 依存**（`qrcode-generator`, `jsqr`）に置き換え、インライン minify を廃止
- **純粋ロジックに単体テスト**を付ける（§8 のテストベクタ）
- GitHub Actions で `pnpm build` → GitHub Pages へ自動配備

### 非ゴール（やらない）
- 機能追加、仕様変更、文言変更、デザイン変更
- フレームワーク導入（React/Vue 等）。**素の JS のまま**分割する
- TypeScript 化（要望があれば別タスク。JSDoc で型注釈を付けるのは可）
- 状態の保存先変更（localStorage のまま）
- バグらしきものを見つけても**黙って直さない**。§9 に追記して報告する（移行のパリティ検証が崩れるため）

---

## 3. 目標ディレクトリ構成

```
savings-pace/
├─ package.json            "type": "module", "packageManager": "pnpm@<version>"
├─ pnpm-lock.yaml
├─ vite.config.js          base: './'、vitest 設定を同居
├─ index.html              マークアップのみ。<script type="module" src="/src/main.js">
├─ CLAUDE.md
├─ public/
│  └─ favicon.svg          旧版は data URI。ファイル化する
├─ src/
│  ├─ main.js              起動処理（旧「起動」節）
│  ├─ styles/
│  │  ├─ tokens.css        :root と dark の CSS 変数
│  │  ├─ base.css          リセット・body・[hidden]・見出し・フォーム部品
│  │  ├─ buttons.css
│  │  ├─ layout.css        .app .grid .sheet .summary .need .ledger …
│  │  ├─ history.css
│  │  ├─ dialogs.css       dialog / .dlg / .toast / .banner
│  │  ├─ qr.css
│  │  └─ main.css          上記を @import（main.js から import する）
│  ├─ core/                ★ DOM に触れない純粋ロジック（テストの主戦場）
│  │  ├─ dates.js          dayNum, parseISO, isoDay, partsOfDay, dim, addMonth, monthEndDay
│  │  ├─ clock.js          today の取得（テストで差し替え可能にする）
│  │  ├─ payCycle.js       payDayOf, lastCountedWorkDay
│  │  ├─ money.js          earnedOf, money()（cash / pending / pendingCounted / nextPay）
│  │  ├─ compute.js        compute()（必要時間の算出）
│  │  ├─ format.js         yen, ceil1, fmtH, fmtHM, fmtDay, fmtISO
│  │  ├─ schema.js         定数, normalizeState（検証・正規化）, createState
│  │  ├─ validation.js     goalError, formMinutes 相当の検証
│  │  └─ qrCodec.js        toCompact, fromCompact, encodePayload, decodePayload, makeChunks, base64url
│  ├─ store/
│  │  ├─ storage.js        load / save（localStorage ラッパ）
│  │  └─ state.js          現在の state の保持・commit・購読
│  ├─ ui/
│  │  ├─ dom.js            $ ヘルパ
│  │  ├─ render.js         render, renderSummary, renderNeed, renderWorked, renderFormMeta
│  │  ├─ history.js        renderHistory + 履歴クリック処理
│  │  ├─ shiftForm.js      勤務フォーム（記録・編集・プレビュー）
│  │  ├─ savingsDialog.js  貯金額の修正
│  │  ├─ setup.js          初回設定
│  │  ├─ settings.js       設定ダイアログ（目標編集・全削除）
│  │  ├─ jsonIO.js         JSON エクスポート / インポート
│  │  ├─ adopt.js          adoptState（JSON・QR 共通の置き換え処理）
│  │  ├─ qrExport.js       QR 書き出し UI（qrcode-generator を import）
│  │  ├─ qrImport.js       QR 読み込み UI（jsqr を import、カメラ・画像）
│  │  ├─ dialogs.js        confirmDialog、背景クリックで閉じる、data-close
│  │  └─ toast.js
│  └─ constants.js         STORAGE_KEY ほか
├─ tests/
│  ├─ core/*.test.js       Vitest（environment: node）
│  ├─ ui/*.test.js         Vitest（environment: jsdom）。ダイアログ・カメラはポリフィル/モック
│  └─ fixtures/            ../handoff/fixtures をコピー
└─ .github/workflows/deploy.yml
```

構成は**目安**。重要なのは「`core/` は DOM を import しない」「UI は `core/` を呼ぶだけ」の2点。ファイル名の細部は変えてよい。

### 旧コード → 新モジュール対応表

| 旧セクション（メインスクリプト内） | 旧行 | 移行先 |
|---|---|---|
| 日付 | 18–39 | `core/dates.js`, `core/clock.js` |
| 給与サイクル | 40–63 | `core/payCycle.js` |
| 表示用フォーマット | 64–79 | `core/format.js` |
| 状態: `earnedOf` / `money` / `savingsNow` | 87–103 | `core/money.js` |
| 状態: `normalizeState` | 104–163 | `core/schema.js` |
| 状態: `load` / `save` | 164–180 | `store/storage.js` |
| 計算: `compute` | 181–217 | `core/compute.js` |
| 描画: `render*` | 218–361 | `ui/render.js`, `ui/history.js` |
| 勤務フォーム | 362–444 | `ui/shiftForm.js`（検証部分は `core/validation.js`） |
| 履歴の操作 | 445–478 | `ui/history.js` |
| 貯金額の修正 | 479–499 | `ui/savingsDialog.js` |
| 目標の検証 | 500–517 | `core/validation.js` |
| 初回設定 | 518–547 | `ui/setup.js` |
| 設定 | 548–579 | `ui/settings.js` |
| エクスポート / インポート（`adoptState` 含む） | 580–654 | `ui/jsonIO.js`, `ui/adopt.js` |
| QR: コーデック | 655–772 | `core/qrCodec.js` |
| QR: 書き出し | 773–837 | `ui/qrExport.js` |
| QR: 読み込み | 838–999 | `ui/qrImport.js` |
| 共通 UI（`confirmDialog`, `toast`） | 1000–1038 | `ui/dialogs.js`, `ui/toast.js` |
| 起動 | 1039– | `src/main.js` |

---

## 4. データモデル（**変更禁止**）

### localStorage

- キー: `savings-pace:v1`（JSON 文字列）
- 読み込み失敗時（壊れた JSON など）: 元の文字列を `savings-pace:v1:broken` に退避し、初回設定画面へ
- 保存失敗時（プライベートモード等）: `#storageWarn` バナーを表示。起動時に書き込みプローブ（`__probe`）も行う
- 他タブでの変更は `storage` イベントで再読込・再描画（その際 `editingId` は破棄）

### 状態オブジェクト（schemaVersion 1）

```jsonc
{
  "app": "savings-pace",
  "schemaVersion": 1,
  "goal": {
    "baseSavings": 50000,          // 整数 >= 0。初回設定時の貯金。以後は不変
    "target": 300000,              // 整数 > 0
    "deadline": "2027-03-31",      // YYYY-MM-DD（実在する日付）
    "hourlyWage": 1200,            // 数値 > 0（小数可）
    "closingDay": 31,              // 整数 1–31。31 = 月末締め（その月の日数でクランプ）
    "payDay": 25,                  // 整数 1–31。翌月の支払日（その月の日数でクランプ）
    "createdAt": "2026-08-01T00:00:00.000Z"  // ISO or ""
  },
  "shifts": [
    { "id": "s-001", "date": "2026-08-20", "minutes": 360,   // 整数 1–1440
      "wage": 1100,                                           // 記録時点の時給（後から変えても過去分は不変）
      "earned": 6600,                                         // 整数。記録時に round(minutes*wage/60)
      "at": "2026-08-20T09:00:00.000Z" }                      // 入力時刻。同日内の並び順に使う
  ],
  "adjustments": [   // 貯金額の手動修正
    { "id": "a-001", "date": "2026-09-15", "delta": -8000, "at": "2026-09-15T12:00:00.000Z" }
  ]
}
```

- `closingDay` / `payDay` は**省略可**（旧形式）。省略時は 31 / 25 として扱う（`fixtures/sample-state.no-paycycle.json`）
- `normalizeState` は検証と正規化を兼ねる。ID は `[\w-]` のみ・64文字まで・重複不可（違反時は新規 ID）。配列は各 20,000 件まで
- エラー文言（日本語）も仕様の一部。UI に表示される（例: `このアプリで書き出したファイルではありません。`）

### 派生値（保存しない）

```
各勤務の入金日 = payDayOf(shift.date, goal)
cash(=画面の「いまの貯金」) = baseSavings + Σ adjustments.delta + Σ { earned | 入金日 <= 今日 }
pending(入金待ち)           = Σ { earned | 入金日 >  今日 }
pendingCounted              = pending のうち 入金日 <= 目標日 の分
```

---

## 5. ビジネスルール（仕様の核心）

### 5.1 日付の扱い

- 日付は文字列 `YYYY-MM-DD` で保持し、計算は**UTC 0時基準の通算日数**（`dayNum = floor(Date.UTC(y,m-1,d)/86400000)`）で行う。夏時間やタイムゾーンの影響を避けるため。**この方式を変えない**
- 「今日」はブラウザのローカル日付（`new Date()` の `getFullYear/Month/Date`）
- 週は**月曜始まり・日曜終わり**固定

### 5.2 給与サイクル（N日締め・翌月M日払い）

- `payDayOf(勤務日, g)`: 勤務日がその月の締め日（`min(closingDay, その月の日数)`）以前なら当月締め、超えたら翌月締め。**支払日 = 締め月の翌月の `min(payDay, その月の日数)` 日**
- `lastCountedWorkDay(目標日, g)`: 目標日までに入金される最後の勤務日（= 該当する締め日）。目標日の月から最大 3 か月遡って、入金日が目標日以前になる最初の締め月を採用。なければ `null`

### 5.3 必要時間 `compute()`

```
mo = money(state)
remaining      = max(0, target − cash − pendingCounted)
remainingHours = remaining / hourlyWage
start          = (今日の勤務を記録済み) ? 今日+1 : 今日
lastWork       = lastCountedWorkDay(目標日)
daysLeft       = lastWork == null ? 0 : lastWork − start + 1

achieved = remaining <= 0           // 達成 or 入金待ちで達成見込み（cashReached = cash >= target）
expired  = remaining > 0 && daysLeft <= 0
lateEarned = pending − pendingCounted   // 目標日に間に合わない入金待ち

period(endDay):  end = min(endDay, lastWork);  days = max(0, end − start + 1)
                 hours = remainingHours × days / daysLeft
week  = period(今週の日曜)      month = period(今月末)
perDay = remainingHours / daysLeft
```

表示ルール:
- 時間は **0.1 時間単位で切り上げ**（`ceil1 = ceil(h*10 − 1e-9)/10`）。整数なら小数点なし（`100`）、そうでなければ小数 1 桁（`3.4`）
- `perDay > 24` のとき警告文を追加
- 今週の残り日数が 0 のとき `今週の残り日数はありません`（0 時間）

### 5.4 勤務フォームの検証

- 日付は実在し、**今日以前**（`今日より先の日付は記録できません。`）
- 時間は小数可（0–24）、分は 0–59 の数値（60 以上はエラー）。合計 `round(h*60)+round(m)` が 1–1440
- 新規記録は**現在の時給**で `earned` を確定。編集は**その勤務に記録された時給**で再計算
- 編集は同じフォームを使い回す（タイトル「勤務を編集」、ボタン「更新する」、キャンセル表示）

### 5.5 貯金額の修正

- 入力は 0 以上。`delta = round(入力) − round(現在の cash)` を `adjustments` に追加（日付は今日）。`delta == 0` なら何もしない
- 勤務・修正の削除は確認ダイアログ付き。削除すると派生値が自動で戻る

### 5.6 設定 / 初回設定の検証

- 初回: 貯金 ≥ 0、目標 > 0、目標日は今日以降、時給 > 0、締め日・支払日は 1–31 の整数、**目標 > 貯金**
- 設定画面: 目標日は**変更したときだけ**「今日以降」を検証（期限切れ後に時給だけ直せるように）。時給変更は過去の勤務に影響しない
- 全データ削除: 確認 → `localStorage.removeItem` → 初回設定画面へ（締め日・支払日の入力欄は 31 / 25 に戻す）

### 5.7 JSON インポート / エクスポート

- ファイル名: `savings-pace-YYYY-MM-DD.json`。中身は状態オブジェクト + `exportedAt`
- インポート: 設定ダイアログを先に閉じる → JSON パース → `normalizeState` → 既存データがあれば置き換え確認 → 保存・再描画。失敗はトースト（エラー色）。**現在の状態は変更しない**
- 置き換え処理は `adoptState` に集約（JSON と QR が共用）

### 5.8 QR 形式（**他バージョンと相互運用できること**）

- 1 枚の文字列: `SP1.<sid>.<番号>.<総数>.<データ>`、検証用正規表現 `^SP1\.([0-9a-z]{4,8})\.(\d{1,3})\.(\d{1,3})\.([A-Za-z0-9_-]+)$`
- `<データ>` を全枚つなげたもの = `'z'` + base64url(deflate(JSON))。`CompressionStream('deflate')`（zlib 形式）。非対応環境では `'j'` + base64url(JSON) で書き出し
- JSON はコンパクト形式: `{"v":1,"g":[baseSavings,target,deadline(通算日数),wage,closingDay,payDay,createdAt(秒)],"s":[[日数差分,minutes,wage,(earned)]…],"a":[[日数差分,delta]…]}`
  - 勤務・修正は (日付, at) の昇順。日付は直前との**差分**。`earned` は `round(minutes*wage/60)` と異なるときだけ 4 番目に入れる
  - **ID と `at` は含めない**。読み込み時に ID を新規発行し、`at` は順序を保つ合成値（`createdAt + i 秒`、修正は `+500000 秒` 以降）を割り当てる
- 分割: 1 枚 380 文字、最大 200 枚。QR は誤り訂正 `M`・Byte モード・クワイエットゾーン 4・SVG（横方向の連続ランで path を最小化）。**暗号化なし**（設定画面に注意書きあり）
- 書き出し UI: 複数枚は 1.6 秒ごとに自動切替。`prefers-reduced-motion` のときは自動再生しない。前へ / 次へ / 一時停止
- 読み込み UI: `getUserMedia({facingMode:{ideal:'environment'}, width:{ideal:1280}})`、映像は幅 960px 以下に縮小して 120ms ごとに `jsQR(…, {inversionAttempts:'dontInvert'})`。**枚数・順序・重複は不問**、別セッションの QR が来たら進捗をリセット。完了で復号 → `normalizeState` → `adoptState`。復号失敗は**エラーメッセージを残したままカメラ再開**
- 画像読み込み: 複数選択可。縮小幅 `[2000, 1000, 640]` で順に試行、`attemptBoth`
- 1 フレームの `jsQR` 例外ではスキャンを止めない（try/catch）

---

## 6. 移行時の設計指針

### 6.1 テストしやすくする（最重要）
旧コードは IIFE 内のグローバル変数 `state` と `now()` に依存している。新構成では:

- `money(state, today)` / `compute(state, today)` のように **「今日」を引数で受ける**（`today = { y, m, d, dow }` もしくは通算日数）。`core/clock.js` は UI 側が呼ぶ唯一の入口にし、テストでは固定値を渡す
- `core/` 内で `window` / `document` / `localStorage` / `navigator` を参照しない
- `core/qrCodec.js` は `CompressionStream` / `TextEncoder` などのグローバルだけに依存（Node 22 にも存在）。**`qrSvg()`（qrcode-generator 依存の描画）は `ui/qrExport.js` 側**
- 状態の更新は `commit(mutator)`（変更 → `save()` → 再描画）に一本化する案を推奨。旧版は「直接書き換え → `save(); render()`」の繰り返し

### 6.2 DOM とイベント
- **要素 ID は変えない**（`#shiftForm`, `#needBody` …）。マークアップは `index.html` に静的に残し、JS は ID で取得する。ID 一覧は `legacy/index.html` を `id="` で grep
- `[hidden] { display: none !important }` に依存している（`hidden` 属性で画面切替）。CSS に必ず残す
- 履歴ボタンは `data-act="edit|del|delAdj"` + `data-id` の**イベント委譲**
- `<dialog>` を使用。背景クリックで閉じる処理（`e.target instanceof HTMLDialogElement`）と `[data-close]` は `document` 全体の click 委譲。`showModal()` 中のダイアログは最前面レイヤーなので、**トーストを出す前に該当ダイアログを閉じる**（QR/JSON インポートで実施済み。この順序を保つ）
- `confirmDialog()` は Promise を返し、`close` イベントで解決。リスナーを毎回外している点を踏襲
- `render()` はフォーム入力値を壊さない（日付の既定値だけ `defaultDate` で管理して日付またぎに追従）

### 6.3 依存ライブラリ
| パッケージ | 旧版 | 新版 |
|---|---|---|
| `qrcode-generator` 2.0.4（MIT） | グローバル `qrcode` | `import qrcode from 'qrcode-generator'`（`exports.import` = `dist/qrcode.mjs`、型定義あり） |
| `jsqr` 1.4.0（Apache-2.0） | グローバル `jsQR` | `import jsQR from 'jsqr'`（`main` のみで `module` なし。**Vite の CJS 解釈で default import になるか要確認**） |

- どちらも `dependencies`（ビルドにバンドルされる）。**CDN には切り替えない**（オフライン動作を維持）
- jsQR はサイズが大きい（minify 約 130KB）。`qrImport.js` を**動的 import** にして初期バンドルから外すのは任意の最適化（挙動が変わらない範囲で）

### 6.4 フォント
`Manrope` + `Zen Kaku Gothic New` を Google Fonts の `<link>`（`preconnect` 付き）で読み込んでいる。**そのまま `index.html` に残す**。セルフホスト化（`@fontsource`）は別タスク。

---

## 7. 移行手順（この順で進める）

**各フェーズ末で `pnpm test` と `pnpm build` が通る状態にしてコミットする。**

### Phase 0 — 足場
1. 新規ディレクトリ（または既存リポジトリ直下）で `pnpm init`、`corepack` で pnpm のバージョンを固定（`packageManager` フィールド）。Node は Vite の要求バージョンに合わせる
2. `pnpm add qrcode-generator jsqr` / `pnpm add -D vite vitest jsdom`
3. `vite.config.js`（§9.1）、`.gitignore`（`node_modules`, `dist`）
4. `legacy/index.html` を**そのまま**リポジトリに残す（パリティ確認用。完了後に削除してよい）
5. `fixtures/` を `tests/fixtures/` にコピー

### Phase 1 — CSS と HTML の分離
1. `<style>` を `src/styles/*.css` に分割（見た目は 1 ピクセルも変えない）
2. `index.html` から `<style>` と 3 つの `<script>` を除去し、`<script type="module" src="/src/main.js">` に置換
3. この時点ではメインスクリプトを **1 ファイルのまま** `src/main.js` に移し、`qrcode` / `jsQR` を import に変えるだけで動くことを確認（分割前のスモーク）

### Phase 2 — 純粋ロジックの切り出し + テスト（★ここが山場）
1. `core/dates.js`, `payCycle.js`, `money.js`, `compute.js`, `format.js`, `schema.js`, `validation.js`, `qrCodec.js` を作り、**`today` を引数化**
2. §8 のテストベクタを Vitest に書く。`reference-tests/pay-cycle.reference.cjs` のケースを移植
3. `fixtures/sample-*.json` を使い、`normalizeState` / `compute` / QR 復号の期待値を固定
4. 旧 `main.js` から `core/` を import する形に置換（UI はまだ 1 ファイルのまま）
5. 旧版の画面と**目視 + `sample-rendered.golden.json`** で一致を確認

### Phase 3 — 状態とストレージ
`store/storage.js`（load/save、`:broken` 退避、プローブ）と `store/state.js` を作り、`storage` イベント同期もここに置く。

### Phase 4 — UI の分割
`ui/` を 1 モジュールずつ切り出す。推奨順: `toast` → `dialogs`（`confirmDialog`）→ `render` / `history` → `shiftForm` → `savingsDialog` → `setup` → `settings` → `jsonIO` / `adopt`。各モジュールは `init()` をエクスポートし、`main.js` が順に呼ぶ（循環 import を避けるため、モジュール間はイベントではなく **`render()` 呼び出しと `state` 経由**で連携）。

### Phase 5 — QR
`qrExport.js`（`qrcode` を import）と `qrImport.js`（`jsqr` を import）。`reference-tests/qr-roundtrip.reference.cjs` のシナリオ（書き出し → 実 QR デコード → カメラ模擬で取り込み → 状態一致 / 破損データ / 置き換え確認 / 1 枚のみ）を Vitest(jsdom) に移植。

### Phase 6 — ビルドと配備
`vite build` の出力確認 → GitHub Actions（§9.2）→ Settings → Pages → Source を **GitHub Actions** に変更 → 配備後に実機確認（§8.4）。

### Phase 7 — 後片付け
`README.md`（開発・ビルド・配備手順）、`CLAUDE.md` の更新、不要になった `legacy/` の扱いをユーザーに確認。

---

## 8. 検証

### 8.1 テストベクタ（時計 = 2026-10-03(土) 12:00 ローカル、時給 1000、締め 31・支払 25 を既定とする）

**`payDayOf(勤務日, g)` → 入金日**

| 勤務日 | closing / pay | 入金日 |
|---|---|---|
| 2026-10-03 | 31 / 25 | 2026-11-25 |
| 2026-10-31 | 31 / 25 | 2026-11-25 |
| 2026-01-31 | 31 / 25 | 2026-02-25 |
| 2026-12-15 | 31 / 25 | 2027-01-25 |
| 2026-10-15 | 15 / 5 | 2026-11-05 |
| 2026-10-16 | 15 / 5 | 2026-12-05 |
| 2026-08-10 | 15 / 5 | 2026-09-05 |
| 2026-01-31 | 31 / 31 | 2026-02-28（月末クランプ） |
| 2026-03-31 | 31 / 31 | 2026-04-30（月末クランプ） |

**`lastCountedWorkDay(目標日, g)`**

| 目標日 | closing / pay | 結果 |
|---|---|---|
| 2027-03-31 | 31 / 25 | 2027-02-28 |
| 2027-03-25 | 31 / 25 | 2027-02-28（支払日当日は含む） |
| 2027-03-20 | 31 / 25 | 2027-01-31 |
| 2026-10-20 | 31 / 25 | 2026-08-31 |
| 2027-03-04 | 15 / 5 | 2027-01-15 |
| 2027-03-05 | 15 / 5 | 2027-02-15 |

**`compute()` / 画面**（基準: 貯金 50,000・目標 300,000・目標日 2027-03-31・勤務なし）

| ケース | 期待 |
|---|---|
| 基準 | 最終勤務日 2027-02-28、残り **149 日**、総必要 **250 時間**、今週（10/3・10/4 の 2 日）**3.4 時間**、今月（10/3–10/31 の 29 日）**48.7 時間**、1 日 **約 1.7 時間** |
| 目標日 2027-03-20 | 最終勤務日 2027-01-31 |
| 今日(10/3)に 300 分の勤務を記録 | 貯金は 50,000 のまま、入金待ち 5,000（次の入金 11/25）。起点は明日になり残り **148 日**、総必要 **245 時間** |
| 8/20 に 600 分 + 9/10 に 600 分 | 貯金 **60,000**（8 月分は 9/25 に入金済み）、9 月分 10,000 は **10/25** まで入金待ち |
| closing 15 / pay 5、10/3 に 60 分 | 入金待ちの次の入金は **11月5日** |
| closing 15 / pay 5、8/10 に 60 分のみ | 貯金 **51,000**（9/5 入金済み） |
| 目標日 2026-10-20・目標 80,000・10/3 に 600 分 | 期限切れ表示（最終勤務日 2026-08-31）+ `目標日に間に合わない入金待ち（¥10,000）は、計算に含めていません。` |
| 目標 55,000・10/3 に 300 分 | 達成表示 `入金待ちを合わせると、目標金額に届きます。`（`cashReached = false`） |

**フォーマット**: `fmtH(3.36)="3.4"`, `fmtH(100)="100"`, `fmtH(0)="0"`, `fmtHM(330)="5時間30分"`, `fmtHM(60)="1時間"`, `fmtHM(45)="45分"`, `yen(-8000)="−¥8,000"`（U+2212）, `yen(48600)="¥48,600"`

### 8.2 フィクスチャによるパリティ

| ファイル | 検証内容 |
|---|---|
| `sample-state.json` | localStorage にそのまま入れて起動 → `sample-rendered.golden.json` と一致（時計固定） |
| `sample-state.no-paycycle.json` | 起動でき、締め 31 / 支払 25 として計算される |
| `sample-export.json` | JSON インポートで取り込め、`exportedAt` は状態に残らない |
| `sample-qr-chunks.json` | 新版の `decodePayload` で復号 → `sample-qr-expected.json` と一致（`id` / `at` は比較対象外） |
| 新版のエクスポート | 新版が出した QR / JSON を**旧版でも読める**こと（`legacy/index.html` を使う）。QR は deflate 出力のバイト一致までは求めない（復号できればよい） |

`sample-rendered.golden.json`（抜粋）:
`savingsAmount: ¥48,600` / `pendingLine: 入金待ち ¥23,050（次の入金は10月25日）` / `barPct: 16%` / `factRemain: ¥251,400` / `factDeadlineSub: あと179日` / 今週 2.6 時間・今月 37.1 時間・目標日まで 190.3 時間

### 8.3 テスト環境の注意（jsdom）
- jsdom は `HTMLDialogElement.showModal/close`、`Canvas.getContext`、`HTMLMediaElement.play`、`CompressionStream`、`Response`、`TextEncoder` 等を欠く。`reference-tests` の `boot()` にポリフィル/モックの実例がある
- 時計固定は `window.Date` をサブクラスで差し替える方式を使っていた。新版では `today` 引数化により UI 以外では不要。UI テストでは `core/clock.js` を `vi.mock` する
- カメラは `getUserMedia` / `video.readyState` / `videoWidth` / `canvas.getContext` / `jsQR` をモックし、`jsQR` が QR 文字列を順に返す形で再現していた
- QR 描画の検証は「SVG の path を RGBA にラスタライズ → 実際の `jsqr` で復号」で行っていた（`qr-roundtrip.reference.cjs`）

### 8.4 実機確認（ユーザーが行う / 自動化不可）
1. スマホ実機でカメラによる QR 読み取り（複数枚）、PC のブラウザとの相互読み取り
2. iOS Safari / Android Chrome での表示崩れ、ダークモード、セーフエリア
3. 旧 URL を開いて、**配備前に保存されていたデータがそのまま表示される**こと
4. JSON のダウンロード（iOS Safari のダウンロード挙動）

### 8.5 完了条件（Definition of Done）
- [ ] `pnpm install --frozen-lockfile && pnpm test && pnpm build` が通る
- [ ] `index.html` にインラインの `<script>` / `<style>` がない
- [ ] `core/` が `window`/`document`/`localStorage` を参照していない
- [ ] §8.1 のテストベクタと §8.2 のフィクスチャが自動テストになっている
- [ ] 旧版と新版で、同じ localStorage に対して画面テキストが一致する
- [ ] 旧版 ↔ 新版で JSON / QR の相互インポートができる
- [ ] GitHub Actions で配備され、**URL が従来と同じ**
- [ ] README に開発・ビルド・配備手順がある

---

## 9. 設定ファイルの叩き台

### 9.1 `vite.config.js`

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './', // GitHub Pages のプロジェクトサイト（/<repo>/）でも相対パスで動く
  build: { target: 'es2022', sourcemap: false },
  test: {
    environment: 'node', // UI テストのファイルだけ先頭に // @vitest-environment jsdom
    include: ['tests/**/*.test.js'],
  },
});
```

### 9.2 `.github/workflows/deploy.yml`（action のメジャーバージョンは最新を確認して更新）

```yaml
name: Deploy to GitHub Pages
on:
  push: { branches: [main] }
  workflow_dispatch: {}
permissions:
  contents: read
  pages: write
  id-token: write
concurrency: { group: pages, cancel-in-progress: true }
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4        # package.json の packageManager を参照
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm test
      - run: pnpm build
      - uses: actions/upload-pages-artifact@v3
        with: { path: dist }
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

### 9.3 `package.json` の scripts

```json
{ "scripts": { "dev": "vite", "build": "vite build", "preview": "vite preview", "test": "vitest run", "test:watch": "vitest" } }
```

---

## 10. 既知の制約・判断済み事項（移行中は**変えない**）

| 項目 | 現状 | メモ |
|---|---|---|
| 勤務する曜日 | 毎日働ける前提で均等割り | 「勤務曜日の指定」は将来案 |
| 週の目標 | 「今日〜日曜の残り分」を毎回再計算。週初めの固定ノルマではない | 固定ノルマ方式は将来案 |
| 振込日の土日祝ずれ | 考慮しない | 実際の入金が前後したら貯金額の修正で合わせる運用 |
| 週の開始 | 月曜固定 | `compute()` の 1 行で変更可能 |
| 今日の勤務を記録済み | 起点を明日にする | 夜に記録する運用を想定 |
| 未来日の勤務 | 記録不可 | 貯金額が先に膨らむのを防ぐ |
| QR | 暗号化なし。ID と入力時刻は転送されず再採番 | JSON は ID・`at` を保持する |
| QR の枚数 | 1 年超など大量データは枚数が増える | 多いときは JSON を案内する文言あり（20 枚超） |
| 時給の小数 | 許容（`earned` は四捨五入の整数） | |
| 日付入力の最大値 | 今日（`max` 属性） | |
| 他タブ同期 | `storage` イベントで再読込。編集中の状態は破棄 | |

### 移行中に気づいたら追記する欄（バグ疑い・改善案）
> 黙って直さず、ここに「現象 / 場所 / 影響 / 提案」を書いてユーザーに報告する。

- **他タブ同期で編集中フォームが「編集」表示のまま残り、送信すると新規記録になる**（Phase 2 で発見・未修正）
  - 現象: 勤務の「編集」を押した状態で、別タブの変更（`storage` イベント）が届くと、`editingId` だけが `null` になり、フォームはタイトル「勤務を編集」・ボタン「更新する」・キャンセル表示・入力値のまま残る。この状態で送信すると、元の勤務は更新されず**同じ内容の勤務が新規追加**される（トーストは「勤務を記録しました」）
  - 場所: 旧メインスクリプト「起動」節の `storage` リスナ（`state = load(); editingId = null; render();`）。新版では `src/main.js` 末尾
  - 影響: 2タブ以上で開いているときだけ。二重計上で貯金額・必要時間がずれる（履歴から削除すれば戻る）
  - 再現: jsdom で sample-state を起動 → 履歴の「編集」をクリック → `storage` イベントを発火 → フォーム送信 → 勤務が 6 件から 7 件に増える
  - 提案: `editingId = null` の代わりに `resetShiftForm()` を呼ぶ（入力中の値は消える）。移行完了後に別タスクで
- 参考（バグではない・移行での差分）: 旧 `compute()` は `now()` を 3 回呼んでいた（`money` 内・`now()`・`todayISO()`）。新 `compute(state, t)` は呼び出し側で 1 回取った `t` を使う。違いが出るのは、計算の途中で日付が変わった瞬間だけ

---

## 11. Claude Code への最初の指示（コピペ用）

```
このリポジトリには handoff/ があります。まず handoff/HANDOFF.md と handoff/CLAUDE.md を最後まで読んでください。
目的は legacy/index.html（単一ファイルの貯金支援アプリ）を、挙動を一切変えずに pnpm + Vite の
ES Modules 構成へ移行することです。

進め方:
1. HANDOFF.md §7 の Phase 0 から順に進め、各フェーズ末で pnpm test と pnpm build を通してコミットする。
2. UI に触る前に、core/ の純粋ロジックを切り出して Vitest で固める（§8.1 のテストベクタと fixtures を使う）。
3. localStorage キー・状態スキーマ・JSON/QR 形式・要素 ID・日本語の文言は変更しない。
4. バグらしきものを見つけても直さず、§10 の追記欄に書いて報告する。
5. Phase 2 完了時点で一度報告し、問題なければ Phase 3 以降に進む。

まず Phase 0 の計画（作るファイルと依存パッケージ）を提示してください。
```
