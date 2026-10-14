CREATE TABLE `collate_function_expression` (
  `id` int(11) NOT NULL,
  `v` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT (concat(_utf8mb4'xC3x80',_utf8mb4'xE6xB1x89') collate utf8mb4_bin),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci