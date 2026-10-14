CREATE TABLE `collate_after_literal` (
  `id` int NOT NULL,
  `v` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT 'AbC',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci