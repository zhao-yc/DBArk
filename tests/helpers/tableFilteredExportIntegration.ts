import { bindTableValueOptionsTarget } from './tableValueOptionsIntegration';

export const tableFilteredExportGate = 'DBARK_TABLE_FILTERED_EXPORT_TEST';

/** 新专项显式双门；复用已验证的六实例身份绑定，不修改进程环境或读取认证文件。 */
export function bindTableFilteredExportTarget(read: () => Record<string, string | undefined>, id: string) {
  return bindTableValueOptionsTarget(() => {
    const env = read();
    if (env[tableFilteredExportGate] !== '1' || env.DBARK_TABLE_VALUE_OPTIONS_TEST) throw Error('筛选导出需独立专项开关，不能借用不同值验收');
    return { ...env, DBARK_TABLE_VALUE_OPTIONS_TEST: env[tableFilteredExportGate] };
  }, id);
}

/** 仅生成本用途随机隔离资源，实际写入由测试原观察连接逐条登记并核对。 */
export function planTableFilteredExportFixture(database: string, marker: string) {
  if (!/^dbark_filteredexport_[a-f0-9]{32}$/.test(database) || !/^dbark-filtered-export:[a-f0-9]{32}$/.test(marker)) throw Error('筛选导出隔离资源身份无效');
  const db = '`' + database + '`', table = db + '.`subject`';
  const labels = ['Alpha', 'alpha', 'Alpha ', '', null, 'NULL', '\n', 'line\nbreak', '尾部中文'];
  const literal = (value: string) => `_utf8mb4 X'${Buffer.from(value).toString('hex')}'`;
  const creates = [
    `CREATE DATABASE ${db} DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci`,
    `CREATE TABLE ${db}.\`__owner\` (marker VARCHAR(100) NOT NULL PRIMARY KEY) ENGINE=InnoDB COMMENT='${marker}:owner'`,
    `CREATE TABLE ${table} (id INT NOT NULL PRIMARY KEY,label VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL,big_value BIGINT UNSIGNED NOT NULL,amount DECIMAL(30,12) NOT NULL,at_value DATETIME(6) NOT NULL,payload VARBINARY(8) NOT NULL,bit_value BIT(64) NOT NULL,approx_value FLOAT NOT NULL,json_value JSON NOT NULL,computed BIGINT GENERATED ALWAYS AS (id * 2) STORED) ENGINE=InnoDB COMMENT='${marker}:subject'`,
    `CREATE VIEW ${db}.\`subject_view\` AS SELECT * FROM ${table}`,
  ];
  const tuples = Array.from({ length: 1105 }, (_, index) => {
    const label = labels[index % labels.length];
    return `(${index + 1},${label === null ? 'NULL' : literal(label)},18446744073709551615,9007199254740993.123456789012,'2026-10-23 12:34:56.123456',X'00ff0a27',18446744073709551615,0.1,'{"precise":"18446744073709551615"}')`;
  });
  const seeds = [`INSERT INTO ${db}.\`__owner\` VALUES ('${marker}')`];
  for (let offset = 0; offset < tuples.length; offset += 250) seeds.push(`INSERT INTO ${table} (id,label,big_value,amount,at_value,payload,bit_value,approx_value,json_value) VALUES ${tuples.slice(offset, offset + 250).join(',')}`);
  return { database, marker, creates, seeds, drop: 'DROP DATABASE ' + db, objects: ['__owner', 'subject', 'subject_view'], rows: 1105 };
}
