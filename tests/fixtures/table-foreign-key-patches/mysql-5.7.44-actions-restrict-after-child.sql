CREATE TABLE `actions_restrict_child` (
  `id` int(11) NOT NULL,
  `cb` int(11) DEFAULT NULL,
  `ca` int(11) DEFAULT NULL,
  `note` varchar(20) COLLATE utf8mb4_bin DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `child_pair` (`ca`,`cb`),
  CONSTRAINT `actions_restrict_fk` FOREIGN KEY (`ca`, `cb`) REFERENCES `actions_restrict_parent` (`pa`, `pb`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin