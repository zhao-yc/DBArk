CREATE TABLE `collate_inside_expression` (
  `id` int NOT NULL,
  `v` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT ((_utf8mb4'AbC' collate utf8mb4_bin)),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci