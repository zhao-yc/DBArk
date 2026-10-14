CREATE TABLE `ordinary_direction` (
  `id` int(11) NOT NULL,
  `a` int(11) NOT NULL,
  `b` int(11) NOT NULL,
  `txt` varchar(900) COLLATE utf8mb4_bin DEFAULT NULL,
  `bytes` varbinary(1000) DEFAULT NULL,
  `short_text` varchar(10) COLLATE utf8mb4_bin DEFAULT NULL,
  `text_value` text COLLATE utf8mb4_bin,
  `blob_value` blob,
  PRIMARY KEY (`id`),
  KEY `ix` (`a`,`b`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC