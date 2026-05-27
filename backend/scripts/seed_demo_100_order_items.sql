-- 假数据：向 order_items 插入约 100 条演示行（一单一行）。
-- 兼容 MySQL 5.7 / 8.x（不用递归 CTE，避免语法与版本差异）。
-- 执行前请备份，仅在测试库使用。
--
-- 用法（示例）：
--   mysql -h127.0.0.1 -uroot -p huijin_tecai < backend/scripts/seed_demo_100_order_items.sql
--   或在 mysql 客户端：SOURCE /path/to/seed_demo_100_order_items.sql;
--
-- 说明：
-- 1) 若不存在 abbr=FAKE 的客户，会插入「演示客户(假数据)」一条。
-- 2) 订单号 hjFAKE + 8 位数字，与正式单号区分。

-- 如需重复执行，可先删旧假数据：
-- DELETE FROM order_items WHERE order_no LIKE 'hjFAKE%';

START TRANSACTION;

INSERT INTO customers (name, abbr, contact_name, phone)
SELECT '演示客户(假数据)', 'FAKE', '演示联系人', '13800000000'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM customers WHERE abbr = 'FAKE' LIMIT 1);

SET @cid := (SELECT id FROM customers WHERE abbr = 'FAKE' LIMIT 1);

-- 用 0–9 × 0–90 叉乘得到 n=1..100（无 RECURSIVE）
INSERT INTO order_items (
  order_no,
  customer_id,
  order_remark,
  sort_order,
  incoming_no,
  material_grade,
  spec_incoming,
  weight_incoming,
  quantity,
  weight_return,
  formed_size,
  forging_requirements,
  remark,
  production_status,
  in_today_queue,
  return_date,
  incoming_date,
  created_at
)
SELECT
  CONCAT('hjFAKE', LPAD(300000 + nums.n, 8, '0')) AS order_no,
  @cid AS customer_id,
  CONCAT('假数据备注', nums.n) AS order_remark,
  0 AS sort_order,
  CONCAT('LM', LPAD(nums.n, 6, '0')) AS incoming_no,
  ELT(1 + MOD(nums.n - 1, 4), '304', '316L', 'TA2', '45#') AS material_grade,
  CONCAT(ROUND(80 + MOD(nums.n, 40), 1), '×', ROUND(20 + MOD(nums.n * 3, 60), 1)) AS spec_incoming,
  ROUND(50 + MOD(nums.n * 7, 500), 3) AS weight_incoming,
  1 + MOD(nums.n, 8) AS quantity,
  NULL AS weight_return,
  CONCAT('φ', ROUND(100 + MOD(nums.n, 50), 0)) AS formed_size,
  NULL AS forging_requirements,
  CONCAT('备注', nums.n) AS remark,
  ELT(
    1 + MOD(nums.n - 1, 10),
    '在库中',
    '开坯',
    '待修磨',
    '修磨中',
    '锻造中',
    '待发回',
    '已发回',
    '出白',
    '固溶',
    '切割'
  ) AS production_status,
  IF(MOD(nums.n, 7) = 0, 1, 0) AS in_today_queue,
  IF(MOD(nums.n, 11) = 0, DATE_ADD(CURDATE(), INTERVAL MOD(nums.n, 30) DAY), NULL) AS return_date,
  DATE_SUB(CURDATE(), INTERVAL MOD(nums.n, 60) DAY) AS incoming_date,
  DATE_SUB(NOW(), INTERVAL MOD(nums.n, 120) DAY) AS created_at
FROM (
  SELECT 1 + ones.n + tens.n AS n
  FROM
    (
      SELECT 0 AS n UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4
      UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9
    ) AS ones
    CROSS JOIN (
      SELECT 0 AS n UNION SELECT 10 UNION SELECT 20 UNION SELECT 30 UNION SELECT 40
      UNION SELECT 50 UNION SELECT 60 UNION SELECT 70 UNION SELECT 80 UNION SELECT 90
    ) AS tens
  WHERE 1 + ones.n + tens.n BETWEEN 1 AND 100
) AS nums;

COMMIT;

SELECT COUNT(*) AS inserted_rows FROM order_items WHERE order_no LIKE 'hjFAKE%';
