-- pricing_master と menu_items に sort_order カラムを追加

ALTER TABLE pricing_master ADD COLUMN IF NOT EXISTS sort_order integer;
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS sort_order integer;

-- 既存データに連番を振る
UPDATE pricing_master SET sort_order = sub.rn
FROM (
  SELECT id, ROW_NUMBER() OVER (ORDER BY customer_type, pricing_type) AS rn
  FROM pricing_master
) sub
WHERE pricing_master.id = sub.id;

UPDATE menu_items SET sort_order = sub.rn
FROM (
  SELECT id, ROW_NUMBER() OVER (ORDER BY category, name) AS rn
  FROM menu_items
) sub
WHERE menu_items.id = sub.id;
