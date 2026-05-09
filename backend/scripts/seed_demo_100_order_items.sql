-- 假数据：向 order_items 插入约 100 条演示行（一单一行）。
-- 适用：MySQL 8.0+（使用 RECURSIVE CTE）。执行前请备份，仅在测试库使用。
--
-- 用法（示例）：
--   mysql -h127.0.0.1 -uroot -p huijin_tecai < backend/scripts/seed_demo_100_order_items.sql
--
-- 说明：
-- 1) 若不存在 abbr=FAKE 的客户，会插入「演示客户(假数据)」一条。
-- 2) 订单号格式 hjFAKE + 8 位数字，与正式 hj+客户缩写+日期+流水 区分，避免与真实规则冲突。

-- 如需重复执行，可先删旧假数据：
-- DELETE FROM order_items WHERE order_no LIKE 'hjFAKE%';

START TRANSACTION;

SET SESSION cte_max_recursion_depth = 1000;

INSERT INTO customers (name, abbr, contact_name, phone)
SELECT '演示客户(假数据)', 'FAKE', '演示联系人', '13800000000'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM customers WHERE abbr = 'FAKE' LIMIT 1);

SET @cid := (SELECT id FROM customers WHERE abbr = 'FAKE' LIMIT 1);

-- 1..100 行
WITH RECURSIVE seq(n) AS (
  SELECT 1
  UNION ALL
  SELECT n + 1 FROM seq WHERE n < 100
)
INSERT INTO order_items (
  order_no,
  customer_id,
  order_remark,
  sort_order,
  incoming_no,
  material_grade,
  production_no,
  spec_incoming,
  weight_incoming,
  quantity,
  weight_return,
  formed_size,
  forging_requirements,
  production_process,
  remark,
  production_status,
  in_today_queue,
  return_date,
  incoming_date,
  created_at
)
SELECT
  CONCAT('hjFAKE', LPAD(300000 + n, 8, '0')) AS order_no,
  @cid AS customer_id,
  CONCAT('假数据备注', n) AS order_remark,
  0 AS sort_order,
  CONCAT('LM', LPAD(n, 6, '0')) AS incoming_no,
  ELT(1 + MOD(n - 1, 4), '304', '316L', 'TA2', '45#') AS material_grade,
  CONCAT('SC', DATE_FORMAT(CURDATE(), '%y%m'), LPAD(n, 4, '0')) AS production_no,
  CONCAT(ROUND(80 + MOD(n, 40), 1), '×', ROUND(20 + MOD(n * 3, 60), 1)) AS spec_incoming,
  ROUND(50 + MOD(n * 7, 500), 3) AS weight_incoming,
  1 + MOD(n, 8) AS quantity,
  NULL AS weight_return,
  CONCAT('φ', ROUND(100 + MOD(n, 50), 0)) AS formed_size,
  NULL AS forging_requirements,
  CONCAT('工序演示-', n) AS production_process,
  CONCAT('备注', n) AS remark,
  ELT(
    1 + MOD(n - 1, 9),
    '未入库',
    '已入库',
    '修磨中',
    '锻造中',
    '待发回',
    '已发回',
    '出白',
    '固溶',
    '切割'
  ) AS production_status,
  IF(MOD(n, 7) = 0, 1, 0) AS in_today_queue,
  IF(MOD(n, 11) = 0, DATE_ADD(CURDATE(), INTERVAL MOD(n, 30) DAY), NULL) AS return_date,
  DATE_SUB(CURDATE(), INTERVAL MOD(n, 60) DAY) AS incoming_date,
  DATE_SUB(NOW(), INTERVAL MOD(n, 120) DAY) AS created_at
FROM seq;

COMMIT;

SELECT COUNT(*) AS inserted_rows FROM order_items WHERE order_no LIKE 'hjFAKE%';
