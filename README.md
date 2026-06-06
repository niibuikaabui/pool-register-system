# ビリヤード場 レジシステム

React + Vite + Tailwind CSS + Supabase で構築したビリヤード場向けレジアプリ。

## セットアップ

### 1. Supabase の準備

Supabase Dashboard の **SQL Editor** で `supabase_setup.sql` を実行してください。

その後、管理者ユーザーを作成します:
1. Authentication > Users > "Add user" でメール・パスワードを設定
2. 作成したユーザーの UUID を確認
3. SQL Editor で以下を実行:
   ```sql
   insert into user_profiles (id, name, role) values ('YOUR_USER_ID', '管理者名', 'admin');
   ```

### 2. ローカル開発

Node.js (v18以上) が必要です。

```bash
npm install
npm run dev
```

### 3. GitHub Pages へのデプロイ

```bash
# リポジトリ名に合わせて vite.config.js の base を変更してください
# 例: base: '/pool_register_system/'

npm run build
npm run deploy
```

## 画面一覧

| 画面 | パス | 権限 |
|------|------|------|
| ログイン | /login | 全員 |
| ダッシュボード | / | staff/admin |
| 会計 | /checkout/:id | staff/admin |
| 会員管理 | /members | staff/admin |
| 売上レポート | /reports | staff/admin |
| マスタ管理 | /master | admin のみ |

## 料金計算ロジック

- 1分単位で計算
- 端数処理: `Math.ceil(fee / 50) * 50`（50円単位切り上げ）
- 例: 320円 → 350円、670円 → 700円

## バーコードリーダー対応

会員管理・会計画面の検索欄にフォーカスした状態でバーコードをスキャンすると、  
USB バーコードリーダーからの入力を自動的に受け取り Enter キーで検索します。
