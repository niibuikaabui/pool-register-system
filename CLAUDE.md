# CLAUDE.md

## システム概要

ビリヤード場向けPOSシステム（通称：ビリヤードレジ）。
台ごとの伝票管理・時間制/フリータイム料金計算・会員管理・ドリンク注文・売上レポートを提供する。

### 技術スタック
- **Frontend**: React + Vite + Tailwind CSS + React Router (HashRouter)
- **Backend**: Supabase (PostgreSQL + Row Level Security)
- **本番公開**: GitHub Pages（`gh-pages` ブランチ）
- **ローカル開発**: Vite Dev Server（port 5173）、`launch.json` 名: "Vite Dev Server"
- **リポジトリ**: `dev` ブランチで開発 → `main` ブランチが本番

### DBテーブル構成

| テーブル | 主な用途 |
|---|---|
| `sessions` | 伝票（1伝票＝1プレーヤー） |
| `tables` | ビリヤード台（1〜5番 + 99=その他） |
| `time_blocks` | プレー時間セグメント（開始/終了） |
| `order_items` | ドリンク等の注文履歴（soft-delete） |
| `members` | 会員情報 |
| `pricing_master` | 区分×種別ごとの料金設定 |
| `menu_items` | メニュー（ドリンク・フード・割引） |
| `shop_settings` | 店舗設定・営業時間 |

#### customer_type の値
`general` / `female` / `university` / `high_school` / `staff`

#### pricing_type の値
`hourly_multi` / `hourly_single` / `freetime_beer` / `freetime_no_beer`

### ページ構成
- `/` → Dashboard（台の状況一覧）
- `/table/:tableId` → TableSlips（台の伝票一覧・一括操作）
- `/checkout/:sessionId?table=:tableId` → 伝票詳細・会計
- `/members` → 会員管理
- `/reports` → 売上レポート
- `/master` → マスタ管理（料金設定/メニュー/店舗設定/ユーザー）

---

## 開発ルール

### デプロイについて
**明確に「デプロイして」と指示されるまで、本番環境（GitHub Pages）へのデプロイは絶対に行わない。**
- 本番デプロイコマンド: `npm run deploy`（これは明示的な指示があるときのみ実行する）

### コミットについて
- コードを修正した場合は、**`dev` ブランチにのみコミット**する。
- `main` ブランチへのマージ・プッシュは行わない。
- コミットメッセージには、**何をどう修正したか**を具体的に記述する（例: `fix: チェックアウト画面の料金ボタンレイアウトを2列グリッドに修正`）。

### 作業フローについて
- バグを指摘された場合は、簡単な原因と対応方針を示した後に、了解を得てから修正に入る。
- 機能追加を指示された場合は、対応方針を示した後に、了解を得てから実装に入る。

### その他
- `member_number` は INTEGER 型のため `ilike` 不可 → `eq` を使用すること。
- `order_items` の削除は `cancelled_at` によるsoft-deleteで行う（物理削除しない）。
- フリータイム時間はコード内定数 `FREETIME_MINUTES`（120分）で管理。
