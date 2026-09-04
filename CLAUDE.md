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

## アーキテクチャ指針（画面・機能追加時に必ず従うこと）

コードは以下の3層に分け、下の層ほど共通ロジックを置く。

| 層 | 場所 | 役割 |
|---|---|---|
| 画面 | `src/pages/` `src/components/` | 表示・UI状態のみ。料金計算式やDB更新パターンを直接書かない |
| フック | `src/hooks/` | 画面用の状態管理（購読・編集フォーム等）。計算・更新は下の層を呼ぶ |
| 共通ロジック | `src/lib/` | 下記モジュールに集約 |

### `src/lib/` のモジュール構成
- **`fees.js`** — 料金計算の純関数（DBアクセスなし）。プレー料金・注文合計の計算は**必ずここを使う**。独自に `price_per_minute × 分` を書かない。
- **`sessionOps.js`** — 伝票・台・時間ブロックの定型DB更新。伝票作成／台の解放判定／台移動／ブロック終了（`locked_fee` 確定）／合計金額の保存は**必ずここを使う**。
- **`constants.js`** — 区分・種別などの定数と `isFreetime()` 判定。
- **`utils.js`** — 汎用フォーマッタ（`roundUp50` / 経過時間表示など）。

### 料金計算のルール（fees.js に実装済み）
- 時間制: 分未満切り捨て → `price_per_minute × 分` → 50円単位切り上げ（`roundUp50`）。
- フリータイム: `freetime_price` の定額。時間ブロックの `locked_fee` は NULL。
- 完了ブロックは終了時に確定した `locked_fee` を最優先で使う。`locked_fee` が NULL（旧データ・フリータイム）の完了ブロックは **0円として扱い、タイムスタンプからの再計算は行わない**（終了後に種別・区分が変更されると「終了時点で本当にフリータイムだったか」を判別できず、現在の種別で誤って時間制課金してしまうため）。
- 時間ブロックの終了は必ず `sessionOps.endActiveBlocks()` を使い、`locked_fee` を確定させる。

## 開発ルール

### デプロイについて
**明確に「デプロイして」と指示されるまで、本番環境（GitHub Pages）へのデプロイは絶対に行わない。**
- 本番デプロイコマンド: `npm run deploy`（これは明示的な指示があるときのみ実行する）

### コミットについて
- コードを修正した場合は、**`dev` ブランチにのみコミット**する。
- `main` ブランチへのマージ・プッシュは行わない。
- コミットメッセージには、**何をどう修正したか**を具体的に記述する（例: `fix: チェックアウト画面の料金ボタンレイアウトを2列グリッドに修正`）。
- **`dev` ブランチへのコミットは確認不要**。修正完了後はそのまま実行する。

### 作業フローについて
**以下のルールを必ず守ること。了解を得る前に絶対にコードを修正しない。**
- バグを指摘された場合は、簡単な原因と対応方針を示した後に、**必ずユーザーの了解を得てから**修正に入る。
- 機能追加を指示された場合は、対応方針を示した後に、**必ずユーザーの了解を得てから**実装に入る。

### その他
- `member_number` は INTEGER 型のため `ilike` 不可 → `eq` を使用すること。
- `order_items` の削除は `cancelled_at` によるsoft-deleteで行う（物理削除しない）。
- フリータイム時間はコード内定数 `FREETIME_MINUTES`（120分）で管理。
