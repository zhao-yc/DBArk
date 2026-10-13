-- 仅在隔离测试库运行；用于比对 Navicat 与 DBArk 可见行为。
-- 执行前核对目标为 200 开发服务器，切勿在生产连接执行。
CREATE DATABASE IF NOT EXISTS dbark_research CHARACTER SET utf8mb4;
USE dbark_research;

CREATE TABLE IF NOT EXISTS editable_fixture (
  id BIGINT UNSIGNED PRIMARY KEY,
  amount DECIMAL(30, 10) NOT NULL,
  title VARCHAR(200) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  payload LONGBLOB NULL,
  optional_note TEXT NULL
) ENGINE=InnoDB;

INSERT INTO editable_fixture (id, amount, title, created_at, payload, optional_note)
VALUES (9007199254740993, 12345678901234567890.1234567890, '精确数值', '2026-10-13 12:34:56.123456', X'0001FF', NULL)
ON DUPLICATE KEY UPDATE title = VALUES(title);

-- 检查大整数、小数、微秒、二进制与 NULL，前端显示和导出均应保留原值。
SELECT * FROM editable_fixture;
-- 多结果集不应互相覆盖。
SELECT '第一个结果' AS result;
SELECT '第二个结果' AS result;
-- 运行后使用取消按钮，再运行 SELECT 1；记录会话是否仍可用。
SELECT SLEEP(30);

-- 在同一标签页开始事务；另一标签页查询时不应看到未提交改动。
START TRANSACTION;
UPDATE editable_fixture SET title = '事务内修改' WHERE id = 9007199254740993;
ROLLBACK;
SELECT title FROM editable_fixture WHERE id = 9007199254740993;

-- DELIMITER 是客户端脚本指令，不能原样发送到数据库服务器。
DROP PROCEDURE IF EXISTS dbark_delimiter_fixture;
DELIMITER $$
CREATE PROCEDURE dbark_delimiter_fixture()
BEGIN
  SELECT '字符串内的分号;不应切分' AS value;
  SELECT 2 AS value;
END$$
DELIMITER ;
CALL dbark_delimiter_fixture();

-- 无唯一键表应只读；不要依据 LIMIT 1 假定行唯一。
CREATE TABLE IF NOT EXISTS no_key_fixture (value VARCHAR(20)) ENGINE=InnoDB;
