CREATE TABLE `metadata_omission` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `v` varchar(80) DEFAULT 'x' COMMENT '字段注释',
  PRIMARY KEY (`id`),
  KEY `idx_v` (`v`(7)) COMMENT '索引注释'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci ROW_FORMAT=DYNAMIC COMMENT='表注释'