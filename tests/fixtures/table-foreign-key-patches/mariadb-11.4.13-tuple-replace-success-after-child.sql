CREATE TABLE `tuple_replace_success_child` (
  `id` int(11) NOT NULL,
  `cb` int(11) DEFAULT NULL,
  `ca` int(11) DEFAULT NULL,
  `note` varchar(20) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `child_pair` (`ca`,`cb`),
  KEY `tuple_replace_success_fk_new` (`cb`,`ca`),
  CONSTRAINT `tuple_replace_success_fk_new` FOREIGN KEY (`cb`, `ca`) REFERENCES `tuple_replace_success_parent` (`pa`, `pb`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin