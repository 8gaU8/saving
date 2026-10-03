# 貯金ペース

アルバイトなどの時給収入で目標の貯金額に届くために、今週・今月・目標日までに何時間働けばよいかを表示する Web アプリです。サーバーはなく、データはブラウザの localStorage（キー `savings-pace:v1`）にだけ保存されます。

## 開発

Node.js 22.22.2 以上と pnpm（バージョンは `package.json` の `packageManager`）が必要です。

```sh
pnpm install
pnpm dev          # 開発サーバ（http://localhost:5173/）
pnpm test         # Vitest（core / store / ui）
pnpm test:watch
pnpm build        # dist/ に出力
pnpm preview      # dist/ を配信して確認
```

## 構成

| 場所 | 内容 |
|---|---|
| `index.html` | マークアップのみ。要素 ID は変更禁止 |
| `src/main.js` | 起動処理（各 UI モジュールの `init()`、読み込み、他タブ同期） |
| `src/core/` | DOM に触れない純粋ロジック（日付、給与サイクル、必要時間、検証、QR 形式）。「今日」は引数で受ける |
| `src/store/` | localStorage の読み書きと現在の状態 |
| `src/ui/` | DOM 操作とイベント。計算は `core/` を呼ぶ |
| `src/styles/` | CSS（`main.css` から旧版と同じ順に `@import`） |
| `tests/` | `core/`・`store/` の単体テストと、jsdom で `src/main.js` を起動する UI テスト（`tests/helpers/boot.js`） |
| `legacy/index.html` | 移行元の単一ファイル版（パリティ確認用） |

作業ルールは `CLAUDE.md`、仕様と移行の経緯は `handoff/HANDOFF.md` を参照してください。

## 配備

`main` に push すると GitHub Actions（`.github/workflows/deploy.yml`）がテストとビルドを行い、`dist/` を GitHub Pages に配備します。

1. リポジトリの Settings → Pages → Source を **GitHub Actions** にする（初回のみ）
2. `main` に push（または Actions 画面から手動実行）

`vite.config.js` は `base: './'` なので、プロジェクトサイト（`/<repo>/`）でもそのまま動きます。**配備 URL を変えないこと**（オリジンやパスが変わると、既存ユーザーの localStorage のデータが見えなくなります）。

## ライセンス表記

- [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator)（MIT License）© Kazuhiko Arase
- [jsQR](https://github.com/cozmo/jsQR)（Apache License 2.0）© Cosmo Wolfe
