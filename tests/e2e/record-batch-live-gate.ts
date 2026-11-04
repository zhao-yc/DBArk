export interface RecordBatchLiveEnvironment {
  host: '192.168.31.200'; port: 13357 | 13380 | 13384 | 13310 | 13311; dialect: 'mysql' | 'mariadb'; user: string; password: string;
  database: string; owner: string; version: string; hostname: string; serverUuid?: string;
}

/** 实库门只消费外层已准备的准确随机库，不读取认证文件、不建库或扩大权限。 */
export function recordBatchLiveEnvironment(env: Record<string, string | undefined>, args: readonly string[], platform: string): Readonly<RecordBatchLiveEnvironment> {
  const fail = (): never => { throw Error('批量记录表单实库门无效：需要200专用基线、准确随机库、owner和服务器身份；禁止覆盖原生资源门。'); };
  if (env.DBARK_RECORD_BATCH_LIVE !== '1' || env.DBARK_INTEGRATION_ENABLED !== '1' || !['darwin', 'win32'].includes(platform)) return fail();
  if (['NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE', 'SSH_AUTH_SOCK', 'SSH_AGENT_PID', 'PWDEBUG', 'DBARK_EXECUTABLE_PATH', 'DBARK_DEV_URL', 'DBARK_USER_DATA'].some(key => env[key] !== undefined)
    || Object.keys(env).some(key => /^DBARK_(?:SSH_|MTLS_)/.test(key) || /^(?:MYSQL_|MARIADB_|POSTGRES_|PGPASSWORD$|DATABASE_URL$)/.test(key))) return fail();
  const { DBARK_TEST_HOST: host, DBARK_TEST_PORT: rawPort, DBARK_TEST_USER: user, DBARK_TEST_PASSWORD: password, DBARK_TEST_DATABASE: database,
    DBARK_BATCH_OWNER: owner, DBARK_BATCH_VERSION: version, DBARK_BATCH_HOSTNAME: hostname, DBARK_BATCH_UUID: serverUuid, DBARK_BATCH_DIALECT: dialect } = env;
  if (host !== '192.168.31.200' || !user || user.length > 200 || !password || password.length > 4096 || !database || !/^dbark_batch_[a-f0-9]{12}$/.test(database) || !owner || !/^[a-f0-9]{32}$/.test(owner)
    || !version || !hostname || !/^[A-Za-z0-9_.-]{1,64}$/.test(hostname)) return fail();
  if (dialect !== 'mysql' && dialect !== 'mariadb') return fail();
  // 端口与版本必须来自同一原兼容基线，不能仅凭MySQL/MariaDB家族名接受任意实例。
  const versions: Record<string, { dialect: string; version: RegExp }> = { '13357': { dialect: 'mysql', version: /^5\.7\.[0-9]+(?:$|[-+])/ }, '13380': { dialect: 'mysql', version: /^8\.0\.[0-9]+(?:$|[-+])/ }, '13384': { dialect: 'mysql', version: /^8\.4\.[0-9]+(?:$|[-+])/ }, '13310': { dialect: 'mariadb', version: /^10\.11\.[0-9]+-MariaDB/ }, '13311': { dialect: 'mariadb', version: /^11\.4\.[0-9]+-MariaDB/ } };
  const baseline = rawPort ? versions[rawPort] : undefined;
  if (!baseline || baseline.dialect !== dialect || !baseline.version.test(version) || (dialect === 'mysql' ? !serverUuid || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(serverUuid) : serverUuid !== undefined)) return fail();
  const fixed = new Map([['--workers', '1'], ['--retries', '0'], ['--repeat-each', '1'], ['--timeout', '120000'], ['--trace', 'off']]);
  for (let index = 0; index < args.length; index++) {
    const value = args[index]; if (/^--(?:config|project|ui|debug)(?:=|$)|^-c/.test(value)) return fail();
    const at = value.indexOf('='), name = at < 0 ? value : value.slice(0, at);
    if (fixed.has(name) && (at < 0 ? args[++index] : value.slice(at + 1)) !== fixed.get(name)) return fail();
  }
  return Object.freeze({ host, port: Number(rawPort) as RecordBatchLiveEnvironment['port'], dialect, user, password, database, owner, version, hostname, ...(serverUuid ? { serverUuid } : {}) });
}

/** 来源条件一旦漂移即永久撤权，禁止恢复旧环境后自动重试原数据库。 */
export function bindRecordBatchLiveEnvironment(read: () => { env: Record<string, string | undefined>; args: readonly string[]; platform: string }) {
  const initial = read(), target = recordBatchLiveEnvironment(initial.env, initial.args, initial.platform), fingerprint = JSON.stringify(target); let valid = true;
  return { target, assertCurrent() {
    if (!valid) throw Error('批量记录表单原实库来源已失效');
    try { const now = read(); if (JSON.stringify(recordBatchLiveEnvironment(now.env, now.args, now.platform)) !== fingerprint) throw Error('批量记录表单实库来源漂移'); }
    catch (reason) { valid = false; throw reason; }
  } };
}
