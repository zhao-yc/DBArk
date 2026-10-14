CREATE TABLE `actions_no_action_child` (
  `id` int(11) NOT NULL,
  `cb` int(11) DEFAULT NULL,
  `ca` int(11) DEFAULT NULL,
  `note` varchar(20) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `child_pair` (`ca`,`cb`),
  CONSTRAINT `actions_no_action_fk` FOREIGN KEY (`ca`, `cb`) REFERENCES `actions_no_action_parent` (`pa`, `pb`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin