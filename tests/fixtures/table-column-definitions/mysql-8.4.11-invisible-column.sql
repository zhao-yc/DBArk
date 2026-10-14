CREATE TABLE `column_invisible` (
  `id` int NOT NULL,
  `hidden_value` int DEFAULT '7' /*!80023 INVISIBLE */,
  `ordinary` int DEFAULT '1',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci