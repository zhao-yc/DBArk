import { isAbsolute } from 'node:path';

type Environment = Record<string, string | undefined>;
const required = ['DBARK_INTEGRATION_ENABLED', 'DBARK_QUERY_ROW_DETAILS_UI', 'DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_TLS', 'DBARK_TEST_USER', 'DBARK_TEST_PASSWORD', 'DBARK_TEST_EXPECTED_SERVER_UUID', 'DBARK_TEST_DATABASE', 'DBARK_QUERY_ROW_DETAILS_MARKER', 'DBARK_EXECUTABLE_PATH'] as const;
const optional = ['DBARK_TEST_SSH', 'DBARK_TEST_CA', 'DBARK_C02_EXECUTABLE_PATH', 'DBARK_DEV_URL', 'ELECTRON_RUN_AS_NODE'] as const;

/** 仅接收Root显式提供的准确实例与随机marker零行库，不查文件、不建连接、不创建认证材料。 */
export function bindQueryRowDetailsUiTarget(read: () => Environment, argv: readonly string[]) {
  const raw = read();
  if (required.some(key => !Object.hasOwn(raw, key) || typeof raw[key] !== 'string' || !raw[key])) throw Error('整行详情验收缺少Root本轮显式配置');
  const marker = raw.DBARK_QUERY_ROW_DETAILS_MARKER!;
  if (raw.DBARK_INTEGRATION_ENABLED !== '1' || raw.DBARK_QUERY_ROW_DETAILS_UI !== '1' || raw.DBARK_TEST_HOST !== '192.168.31.200' || raw.DBARK_TEST_PORT !== '13384' || raw.DBARK_TEST_TLS !== '0'
    || !/^[a-f0-9]{32}$/u.test(marker) || raw.DBARK_TEST_DATABASE !== 'dbark_row_details_' + marker
    || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(raw.DBARK_TEST_EXPECTED_SERVER_UUID!)
    || !isAbsolute(raw.DBARK_EXECUTABLE_PATH!) || !/\.exe$/iu.test(raw.DBARK_EXECUTABLE_PATH!)
    || ![undefined, '', '0'].includes(raw.DBARK_TEST_SSH) || ![undefined, ''].includes(raw.DBARK_TEST_CA)
    || Object.hasOwn(raw, 'DBARK_DEV_URL') || Object.hasOwn(raw, 'ELECTRON_RUN_AS_NODE')) throw Error('整行详情仅允许Root准备的200/13384/MySQL8.4.11、明文直连和准确Windows安装产物');
  const canonicalAlias = (key: string) => key === 'DBARK_C02_EXECUTABLE_PATH' && raw[key] === raw.DBARK_EXECUTABLE_PATH;
  const allowedTest = new Set<string>([...required, ...optional]);
  const forbidden = (key: string) => /^DBARK_(?:SSH_|MTLS_|C02_|TEST_)/u.test(key) && !canonicalAlias(key) && (!allowedTest.has(key) || key.startsWith('DBARK_C02_'));
  if (Object.keys(raw).some(forbidden)) throw Error('整行详情不接受其它实例、SSH、证书或C02运行配置');
  for (const [index, value] of argv.entries()) {
    if (value === '--trace' && argv[index + 1] !== 'off' || value.startsWith('--trace=') && value !== '--trace=off') throw Error('整行详情实库UI禁止开启trace');
  }
  const fixed = [...required, ...optional].map(key => ({ key, present: Object.hasOwn(raw, key), value: raw[key] }));
  let invalid = false;
  return {
    target: Object.freeze({ host: '192.168.31.200', port: 13384, user: raw.DBARK_TEST_USER!, password: raw.DBARK_TEST_PASSWORD!, uuid: raw.DBARK_TEST_EXPECTED_SERVER_UUID!, database: raw.DBARK_TEST_DATABASE!, marker, executable: raw.DBARK_EXECUTABLE_PATH! }),
    /** 任一步观察到配置变化即永久停链，不能借恢复原值继续本例。 */
    assertCurrent() {
      const current = read();
      if (invalid || fixed.some(({ key, present, value }) => Object.hasOwn(current, key) !== present || current[key] !== value) || Object.keys(current).some(forbidden)) {
        invalid = true; throw Error('整行详情本轮配置已变化，保留现场并永久停链');
      }
    },
  };
}
export type QueryRowDetailsUiBinding = ReturnType<typeof bindQueryRowDetailsUiTarget>;

export const queryRowDetailsUiValues = Object.freeze({ bigint: '18446744073709551615', nextBigint: '18446744073709551614', decimal: '0.12345678901234567890', json: ' {"same":1,"same":2,"precise":9007199254740993} ', html: '<img src=x onerror="throw new Error(1)"><script>throw new Error(2)</script>', long: '长'.repeat(300) + '\r\n原换行' });

/** 两次明确执行均为单条只读SELECT；subject只被COUNT读取，不生成DDL、DML或未知清理。 */
export function queryRowDetailsUiSql(target: QueryRowDetailsUiBinding['target']) {
  if (!/^[a-f0-9]{32}$/u.test(target.marker) || target.database !== 'dbark_row_details_' + target.marker) throw Error('整行详情SQL目标身份不符');
  const literal = (value: string) => "'" + value.replaceAll("'", "''") + "'", subject = '`' + target.database + '`.`subject`';
  const first = `SELECT
  CASE p.n WHEN 1 THEN CAST('${queryRowDetailsUiValues.bigint}' AS UNSIGNED) ELSE CAST('${queryRowDetailsUiValues.nextBigint}' AS UNSIGNED) END AS \`重复\`,
  CAST('${queryRowDetailsUiValues.decimal}' AS DECIMAL(30,20)) AS \`重复\`,
  NULL AS null_value, '' AS empty_value,
  _binary X'00FF' AS bytes_value, _binary X'' AS empty_bytes,
  ${literal(queryRowDetailsUiValues.json)} AS json_text,
  CONCAT(REPEAT('长',300),CHAR(13 USING utf8mb4),CHAR(10 USING utf8mb4),'原换行') AS long_text,
  ${literal(queryRowDetailsUiValues.html)} AS html_text,
  CONCAT('隐藏-',p.n) AS hidden_value,
  @@server_uuid AS server_uuid, @@version AS server_version,
  DATABASE() AS database_name, '${target.marker}' AS marker,
  CAST((SELECT COUNT(*) FROM ${subject}) AS CHAR) AS subject_zero
FROM (SELECT 1 AS n UNION ALL SELECT 2 AS n) AS p ORDER BY p.n`;
  const second = `SELECT '二次结果-${target.marker}' AS refreshed, @@server_uuid AS server_uuid, DATABASE() AS database_name, CAST((SELECT COUNT(*) FROM ${subject}) AS CHAR) AS subject_zero`;
  return Object.freeze({ first, second });
}
