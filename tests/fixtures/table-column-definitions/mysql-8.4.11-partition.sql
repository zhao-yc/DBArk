CREATE TABLE `partition_range` (
  `id` int NOT NULL,
  `note` varchar(80) COLLATE utf8mb4_general_ci DEFAULT '分区',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
/*!50100 PARTITION BY RANGE (`id`)
(PARTITION p0 VALUES LESS THAN (10) ENGINE = InnoDB,
 PARTITION pmax VALUES LESS THAN MAXVALUE ENGINE = InnoDB) */