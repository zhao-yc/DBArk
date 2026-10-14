CREATE TABLE `add_cross_schema_parent` (
  `id` int NOT NULL,
  `pb` int NOT NULL,
  `pa` int NOT NULL,
  `note` varchar(20) COLLATE utf8mb4_bin DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `parent_pair` (`pa`,`pb`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin