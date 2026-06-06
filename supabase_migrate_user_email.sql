-- user_profiles に email カラムを追加
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS email text;
