# 貯金ペース — 作業ルール

アルバイトの時給収入で貯金目標に届くための必要勤務時間を表示する、サーバーなしの Web アプリ（日本語 UI）。
単一 HTML（`legacy/index.html`）から **pnpm + Vite の ES Modules 構成**へ移行済み（Phase 0–5 完了、Phase 6 は配備待ち）。
仕様・テストベクタ・移行の経緯は `handoff/HANDOFF.md` が正。開発・配備手順は `README.md`。

## 絶対に守ること

- **挙動を変えない**リファクタリング。機能追加・文言変更・デザイン変更をしない
- 次は**変更禁止**: localStorage キー `savings-pace:v1`、状態スキーマ（schemaVersion 1）、JSON エクスポート形式、QR 形式（`SP1.<sid>.<n>.<total>.<data>`）、要素 ID、日本語の文言
- 配備 URL を変えない（変えると既存ユーザーの localStorage が見えなくなる）
- バグらしきものを見つけても**黙って直さない**。`handoff/HANDOFF.md` §10 の追記欄に「現象 / 場所 / 影響 / 提案」を書いて報告する
- フレームワーク（React/Vue 等）と TypeScript は導入しない。素の JS（ES Modules）。型は JSDoc まで

## コマンド

```
pnpm install
pnpm dev        # Vite 開発サーバ
pnpm build      # dist/ に出力
pnpm test       # Vitest
```

## 構成の方針

- `src/core/` は**純粋ロジック**。`window` / `document` / `localStorage` / `navigator` を参照しない。「今日」は引数で受ける
- `src/ui/` は DOM 操作。`core/` を呼ぶだけで、計算ロジックを持たない
- `src/store/` は localStorage と現在の state（`state` は live binding。書き換えは `setState`）
- UI モジュールは `init()` をエクスポートし `main.js` が順に呼ぶ。循環 import を作らない（描画は `ui/render.js` に集約し、操作側から `render()` を呼ぶ）
- 画面の共有状態（`editingId` / `historyLimit` / `defaultDate`）は `ui/uiState.js`
- 日付は `YYYY-MM-DD` 文字列 + UTC 基準の通算日数で計算（タイムゾーン・夏時間の影響を避ける）。この方式を変えない
- 週は月曜始まり。時間表示は 0.1 時間単位で切り上げ
- `[hidden] { display: none !important }` に依存している。CSS に残す
- `<dialog>` の最前面レイヤーのため、トーストを出す前に該当ダイアログを閉じる

## テスト

- テストベクタは `handoff/HANDOFF.md` §8.1、フィクスチャは `handoff/fixtures/`
- 旧版に対する参照テスト `handoff/reference-tests/*.cjs` は `tests/ui/payCycle.test.js`・`tests/ui/qr.test.js` に移植済み
- UI テストは `tests/helpers/boot.js` の `boot(state, now, before)` で、新しい jsdom に `src/main.js` を読み込む（時計は `Date` だけ固定）
- 画面テキストは `tests/ui/golden.test.js` で旧版の出力（`sample-rendered.golden.json`）と照合している。挙動を変える変更はここで落ちる
- `pnpm test` と `pnpm build` が通る状態でコミットする

## 依存

- `qrcode-generator`（書き出し）、`jsqr`（読み込み）。CDN は使わない（オフライン動作を維持）
- フォントは Google Fonts の `<link>` のまま（`index.html` に残す）
