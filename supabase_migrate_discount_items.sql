-- 割引メニューアイテムを追加
INSERT INTO menu_items (name, category, price, is_available)
VALUES
  ('50円引', 'discount', -50, true),
  ('100円引', 'discount', -100, true)
ON CONFLICT DO NOTHING;
