CREATE TABLE `combined_common` (
  `id` int NOT NULL,
  `ordinary` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT 'NULL' COMMENT '普通列',
  `ts` timestamp(6) NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `amount` int DEFAULT '1',
  `computed` int GENERATED ALWAYS AS ((`amount` + 1)) STORED,
  PRIMARY KEY (`id`),
  KEY `idx_ordinary` (`ordinary`(8)),
  CONSTRAINT `ck_amount` CHECK ((`amount` >= 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci