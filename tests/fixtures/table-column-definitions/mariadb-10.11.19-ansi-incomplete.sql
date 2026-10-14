CREATE TABLE "metadata_omission" (
  "id" int(11) NOT NULL AUTO_INCREMENT,
  "v" varchar(80) DEFAULT 'x' COMMENT '字段注释',
  PRIMARY KEY ("id"),
  KEY "idx_v" ("v"(7))
)