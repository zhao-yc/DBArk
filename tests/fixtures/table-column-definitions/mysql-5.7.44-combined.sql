CREATE TABLE `combined_common` (
  `id` int(11) NOT NULL,
  `ordinary` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT 'NULL' COMMENT '普通列',
  `ts` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `amount` int(11) DEFAULT '1',
  `computed` int(11) GENERATED ALWAYS AS ((`amount` + 1)) STORED,
  PRIMARY KEY (`id`),
  KEY `idx_ordinary` (`ordinary`(8))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4