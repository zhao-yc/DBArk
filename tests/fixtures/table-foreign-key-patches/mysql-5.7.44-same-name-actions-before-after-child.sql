CREATE TABLE `same_name_actions_child` (
  `id` int(11) NOT NULL,
  `cb` int(11) DEFAULT NULL,
  `ca` int(11) DEFAULT NULL,
  `note` varchar(20) COLLATE utf8mb4_bin DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `child_pair` (`ca`,`cb`),
  CONSTRAINT `same_name_actions_fk` FOREIGN KEY (`ca`, `cb`) REFERENCES `same_name_actions_parent` (`pa`, `pb`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin