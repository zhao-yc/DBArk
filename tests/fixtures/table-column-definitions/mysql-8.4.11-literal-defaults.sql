CREATE TABLE `literal_defaults` (
  `id` int NOT NULL,
  `no_default` int NOT NULL,
  `implicit_null` varchar(20) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `explicit_null` varchar(20) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `empty_text` varchar(20) COLLATE utf8mb4_general_ci DEFAULT '',
  `text_null` varchar(20) COLLATE utf8mb4_general_ci DEFAULT 'NULL',
  `wide_integer` bigint unsigned DEFAULT '18446744073709551615',
  `exact_decimal` decimal(30,12) DEFAULT '-123456789012345678.123456789012',
  `bits` bit(8) DEFAULT b'1011010',
  `binary_value` varbinary(8) DEFAULT 0x0027FF5C,
  `bool_value` tinyint(1) DEFAULT '1',
  `__proto__` varchar(80) COLLATE utf8mb4_general_ci DEFAULT 'proto, DEFAULT COMMENT',
  `constructor` varchar(80) COLLATE utf8mb4_general_ci DEFAULT '构造',
  `tick``name` enum('a,b','DEFAULT','it''s') COLLATE utf8mb4_general_ci DEFAULT 'a,b' COMMENT 'COMMENT, DEFAULT (保留)',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci