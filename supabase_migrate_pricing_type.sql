-- ============================================================
-- pricing_type を hourly_multi / hourly_single に分割するマイグレーション
-- Supabase Dashboard > SQL Editor で実行してください
-- ============================================================

-- 1. pricing_master のチェック制約を更新
ALTER TABLE pricing_master DROP CONSTRAINT IF EXISTS pricing_master_pricing_type_check;
ALTER TABLE pricing_master ADD CONSTRAINT pricing_master_pricing_type_check
  CHECK (pricing_type IN ('hourly_multi', 'hourly_single', 'freetime'));

-- 2. sessions のチェック制約を更新
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_pricing_type_check;
ALTER TABLE sessions ADD CONSTRAINT sessions_pricing_type_check
  CHECK (pricing_type IN ('hourly_multi', 'hourly_single', 'freetime'));

-- 3. 既存の 'hourly' データを 'hourly_multi' に移行
UPDATE pricing_master SET pricing_type = 'hourly_multi' WHERE pricing_type = 'hourly';
UPDATE sessions        SET pricing_type = 'hourly_multi' WHERE pricing_type = 'hourly';

-- 4. 'hourly_single' の料金行を追加（hourly_multi と同じ初期値で作成）
INSERT INTO pricing_master (customer_type, pricing_type, price_per_minute, freetime_price)
SELECT customer_type, 'hourly_single', price_per_minute, NULL
FROM pricing_master
WHERE pricing_type = 'hourly_multi'
ON CONFLICT (customer_type, pricing_type) DO NOTHING;
