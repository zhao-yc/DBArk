CREATE TABLE `actions_restrict_child` (
  `id` int NOT NULL,
  `cb` int DEFAULT NULL,
  `ca` int DEFAULT NULL,
  `note` varchar(20) COLLATE utf8mb4_bin DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `child_pair` (`ca`,`cb`),
  CONSTRAINT `actions_restrict_fk` FOREIGN KEY (`ca`, `cb`) REFERENCES `actions_restrict_parent` (`pa`, `pb`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin