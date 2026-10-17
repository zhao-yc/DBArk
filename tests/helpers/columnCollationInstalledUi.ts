import { win32 } from 'node:path';

type Environment = Record<string, string | undefined>;
const required = ['DBARK_INTEGRATION_ENABLED','DBARK_COLUMN_COLLATION_UI','DBARK_COLUMN_COLLATION_KIND','DBARK_COLUMN_COLLATION_MARKER','DBARK_TEST_HOST','DBARK_TEST_PORT','DBARK_TEST_TLS','DBARK_TEST_USER','DBARK_TEST_PASSWORD','DBARK_TEST_DATABASE','DBARK_TEST_EXPECTED_SERVER_UUID','DBARK_EXECUTABLE_PATH'] as const;
const optional = ['DBARK_TEST_SSH','DBARK_TEST_CA','DBARK_C02_EXECUTABLE_PATH'] as const;
const before = Object.freeze({ charset: 'utf8mb4', collation: 'utf8mb4_0900_ai_ci' });
const after = Object.freeze({ charset: 'utf8mb4', collation: 'utf8mb4_0900_as_cs' });

/** 每个进程只接受一种Root资源身份；纯配置绑定不读.env、安装文件或连接数据库。 */
export function bindColumnCollationInstalledTarget(read: () => Environment, argv: readonly string[], platform: string) {
  if (platform !== 'win32') throw Error('列排序规则正式安装验收仅允许Windows；未读取认证配置');
  const raw = read();
  if (required.some(key => !Object.hasOwn(raw,key) || typeof raw[key] !== 'string' || !raw[key])) throw Error('列排序规则安装验收缺少Root本轮显式配置');
  const kind = raw.DBARK_COLUMN_COLLATION_KIND, marker = raw.DBARK_COLUMN_COLLATION_MARKER!, executable = raw.DBARK_EXECUTABLE_PATH!;
  if (platform !== 'win32' || kind !== 'char' && kind !== 'varchar' || !/^[a-f0-9]{32}$/u.test(marker) || raw.DBARK_TEST_DATABASE !== `dbark_column_collation_${kind}_${marker}`
    || raw.DBARK_TEST_HOST !== '192.168.31.200' || raw.DBARK_TEST_PORT !== '13384' || raw.DBARK_TEST_TLS !== '0'
    || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(raw.DBARK_TEST_EXPECTED_SERVER_UUID!)
    || !win32.isAbsolute(executable) || !/^[A-Za-z]:[\\/]/u.test(executable) || win32.basename(executable).toLowerCase() !== 'dbark.exe' || /(?:^|[\\/])\.{1,2}(?:[\\/]|$)|[\r\n\0]/u.test(executable)
    || ![undefined,'','0'].includes(raw.DBARK_TEST_SSH) || ![undefined,''].includes(raw.DBARK_TEST_CA)) throw Error('列排序规则只允许Windows新安装DBArk、准确200/13384/MySQL8.4.11明文和本轮单类型marker库');
  const allowed = new Set<string>([...required,...optional]);
  const forbidden = (key: string) => /^DBARK_(?:TEST_|COLUMN_COLLATION_|SSH_|TLS_|MTLS_|AUTH_|C02_|DEV_URL)/u.test(key) && (!allowed.has(key) || key === 'DBARK_C02_EXECUTABLE_PATH' && raw[key] !== executable)
    || /^DBARK_.*(?:SSH|TLS|MTLS|AUTH|CERT)/iu.test(key) && !allowed.has(key)
    || /^(?:SSH_AUTH_SOCK|SSH_AGENT_PID|NODE_EXTRA_CA_CERTS|NODE_TLS_REJECT_UNAUTHORIZED|MYSQL_PWD|MYSQL_TEST_LOGIN_FILE|DATABASE_URL|SSL_CERT_FILE|SSL_CERT_DIR|ELECTRON_RUN_AS_NODE)$/u.test(key);
  if (Object.keys(raw).some(forbidden)) throw Error('列排序规则安装验收拒绝未知SSH/TLS/auth/证书或其它运行配置');
  /** 固定串行、零重试/重复、首错停链；CLI不能覆盖为其它记录或执行策略。 */
  function option(name: string, expected: string) {
    const values = argv.flatMap((value,index) => value === name ? [argv[index+1]] : value.startsWith(name+'=') ? [value.slice(name.length+1)] : []);
    if (values.length !== 1 || values[0] !== expected) throw Error('列排序规则安装验收必须显式固定'+name+'='+expected);
  }
  option('--trace','off'); option('--workers','1'); option('--retries','0'); option('--repeat-each','1'); option('--max-failures','1');
  const files = argv.filter(value => /\.spec\.[cm]?[jt]sx?$/u.test(value.replaceAll('\\','/')));
  if (files.length !== 1 || !/(?:^|\/)column-collation-installed\.spec\.ts$/u.test(files[0].replaceAll('\\','/'))) throw Error('列排序规则安装验收只允许本片单一spec');
  const fixed = [...required,...optional].map(key => ({ key, present: Object.hasOwn(raw,key), value: raw[key] })); let invalid = false;
  return {
    target: Object.freeze({ host:'192.168.31.200',port:13384,kind:kind as 'char'|'varchar',table:kind+'_subject',column:'payload',database:raw.DBARK_TEST_DATABASE!,marker,user:raw.DBARK_TEST_USER!,password:raw.DBARK_TEST_PASSWORD!,uuid:raw.DBARK_TEST_EXPECTED_SERVER_UUID!,executable,before,after }),
    /** 只要观察到身份漂移即永久停止，不因恢复环境值重新获得同一身份。 */
    assertCurrent() { const current=read(); if (invalid || fixed.some(({key,present,value}) => Object.hasOwn(current,key)!==present || current[key]!==value) || Object.keys(current).some(forbidden)) { invalid=true; throw Error('列排序规则本轮资源身份已变化，保留现场并永久停链'); } },
  };
}
export type ColumnCollationInstalledBinding = ReturnType<typeof bindColumnCollationInstalledTarget>;
