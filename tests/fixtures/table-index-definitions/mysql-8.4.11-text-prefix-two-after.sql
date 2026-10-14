CREATE TABLE `text_prefix_two` (
  `id` int NOT NULL,
  `a` int NOT NULL,
  `b` int NOT NULL,
  `txt` varchar(900) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `bytes` varbinary(1000) DEFAULT NULL,
  `short_text` varchar(10) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `text_value` text CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
  `blob_value` blob,
  PRIMARY KEY (`id`),
  UNIQUE KEY `ix` (`txt`(2)) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC