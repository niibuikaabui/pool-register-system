-- 台6〜10の削除マイグレーション
-- 実行前に sessions が残っていないことを確認する

-- 1. 台6〜10にぶら下がるセッション（および関連データ）を確認
--    以下の SELECT で件数が 0 であることを確認してから 2 へ進む
SELECT s.id, s.table_id, t.table_number
FROM sessions s
JOIN tables t ON t.id = s.table_id
WHERE t.table_number BETWEEN 6 AND 10;

-- 2. セッションが残っている場合はここで手動クローズ or 下記を実行（cascade で消える）
-- DELETE FROM sessions
-- WHERE table_id IN (SELECT id FROM tables WHERE table_number BETWEEN 6 AND 10);

-- 3. 台6〜10を削除（sessions が残っていると外部キー制約でエラーになる）
DELETE FROM tables
WHERE table_number BETWEEN 6 AND 10;

-- 4. 初期データ投入 SQL も合わせて更新（今後の再セットアップ用）
-- supabase_setup.sql の insert into tables 行を (1),(2),(3),(4),(5),(99) に変えること
