CREATE TABLE `add_cross_schema_child` (
  `id` int NOT NULL,
  `cb` int DEFAULT NULL,
  `ca` int DEFAULT NULL,
  `note` varchar(20) COLLATE utf8mb4_bin DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `child_pair` (`ca`,`cb`),
  CONSTRAINT `add_cross_schema_fk` FOREIGN KEY (`ca`, `cb`) REFERENCES `fixture_parent_schema`.`add_cross_schema_parent` (`pa`, `pb`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin