CREATE TABLE `tuple_replace_success_child` (
  `id` int NOT NULL,
  `cb` int DEFAULT NULL,
  `ca` int DEFAULT NULL,
  `note` varchar(20) COLLATE utf8mb4_bin DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `child_pair` (`ca`,`cb`),
  KEY `tuple_replace_success_fk_new` (`cb`,`ca`),
  CONSTRAINT `tuple_replace_success_fk_new` FOREIGN KEY (`cb`, `ca`) REFERENCES `tuple_replace_success_parent` (`pa`, `pb`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin