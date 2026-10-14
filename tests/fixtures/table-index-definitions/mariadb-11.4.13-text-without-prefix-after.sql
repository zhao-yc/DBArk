CREATE TABLE `text_without_prefix` (
  `id` int(11) NOT NULL,
  `a` int(11) NOT NULL,
  `b` int(11) NOT NULL,
  `txt` varchar(900) DEFAULT NULL,
  `bytes` varbinary(1000) DEFAULT NULL,
  `short_text` varchar(10) DEFAULT NULL,
  `text_value` text DEFAULT NULL,
  `blob_value` blob DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `ix` (`text_value`(768)) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC