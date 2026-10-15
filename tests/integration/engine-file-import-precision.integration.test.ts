import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, rm, rmdir, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import mysql, { type ResultSetHeader } from 'mysql2';
import ExcelJS from 'exceljs';
import { Engine } from '../../src/engine';
import { closeMysqlConnection, connect, execute, type ManagedConnection } from '../../src/engine/connection';
import { identifier, qualified } from '../../src/engine/sql';
import type { ConnectionProfile, TaskEvent } from '../../src/shared/contracts';
import { generatedWarningCreateSql, generatedWarningTableName, probeGeneratedColumnWarning, type GeneratedWarningProbe } from './file-import-generated-warning.fixture';
import { timestampWarningCreateSql, timestampWarningTableName, timestampWarningSafeValue, timestampWarningOverflowValue, probeTimestampRangeWarning, type TimestampWarningProbe } from './file-import-timestamp-warning.fixture';

// 必须由统筹核对 Server-200 身份并同时开启两个开关；本文件不读 env 文件或执行 Docker。
const enabled = process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_FILE_IMPORT_PRECISION_INTEGRATION_ENABLED === '1';
const runId = randomUUID().replaceAll('-', '').slice(0, 12), database = `dbark_file_import_${runId}`;
const fileRoot = resolve(process.cwd(), '.cache', 'engine-file-import-precision'), folder = join(fileRoot, runId);
const allowedTables = new Set(['precision_source', 'precision_xlsx', 'precision_csv', 'precision_json', 'decimal_scale', 'decimal_overflow', 'short_text', 'small_integer', 'short_time', 'fixed_float', 'fixed_double', 'warning_rows', generatedWarningTableName, timestampWarningTableName, ...['xlsx', 'csv', 'json'].flatMap(format => [`bit_text_${format}`, `bit_binary_${format}`])]);
const profile: ConnectionProfile = { id: randomUUID(), name: '文件导入精度隔离验收', group: '', color: '#345678', dialect: 'mysql', host: process.env.DBARK_TEST_HOST ?? '', port: Number(process.env.DBARK_TEST_PORT ?? 13384), user: process.env.DBARK_TEST_USER ?? '', password: process.env.DBARK_TEST_PASSWORD ?? '',
  ...(process.env.DBARK_TEST_TLS === '1' ? { tls: { enabled: true, rejectUnauthorized: true, caPath: process.env.DBARK_TEST_CA } } : {}),
  ...(process.env.DBARK_TEST_SSH === '1' ? { ssh: { enabled: true, host: process.env.DBARK_TEST_SSH_HOST ?? '', port: Number(process.env.DBARK_TEST_SSH_PORT ?? 22), user: process.env.DBARK_TEST_SSH_USER ?? '', privateKeyPath: process.env.DBARK_TEST_SSH_KEY, hostFingerprint: process.env.DBARK_TEST_SSH_FINGERPRINT } } : {}) };
const engineProfile = { ...profile, id: randomUUID(), database };
type Driver = ReturnType<typeof mysql.createConnection>;
interface Frame { sql: string; warningStatus?: number; affectedRows?: number; diagnosticCodes?: number[]; errorCode?: string; }
interface DriverRecord { driver: Driver; frames: Frame[]; scoped: boolean; nonStrict: boolean; initialized?: Promise<void>; restoreMethods?(): void; }
interface Command { on(name: string, callback: (...args: unknown[]) => void): unknown; }
type DriverMethod = (...args: unknown[]) => Command;
const drivers = new Set<DriverRecord>(), rawConnections = new Set<ManagedConnection>(), files = new Set<string>();
const events: TaskEvent[] = [];
let engine: Engine | undefined, admin: ManagedConnection | undefined, observer: ManagedConnection | undefined, restoreDrivers: (() => void) | undefined;
let createAttempted = false, folderCreated = false, globalMode: unknown;
let warningProbe: { okWarning: boolean; warningStatus: number | null; diagnosticCodes: number[]; state: 'ok' | 'warning-error' } | undefined;
let generatedWarningProbe: GeneratedWarningProbe | undefined;
let timestampWarningProbe: TimestampWarningProbe | undefined;

/** 建连与每次夹具写入前都限制真实目标，不能回退到本机、其它端口或任意库。 */
function assertTarget(): void {
  if (profile.host !== '192.168.31.200' || ![13357, 13380, 13384, 13310, 13311, 13484].includes(profile.port) || !profile.user) throw new Error('本专项只允许统筹注入的 200 六个既有隔离端口及明确账号');
  if (profile.port === 13484 && !profile.tls?.enabled) throw new Error('13484 必须显式启用严格 TLS');
  if (database !== `dbark_file_import_${runId}` || !/^dbark_file_import_[a-f0-9]{12}$/.test(database)) throw new Error('拒绝操作非本轮随机隔离库');
  if (dirname(folder) !== fileRoot || basename(folder) !== runId || !/^[a-f0-9]{12}$/.test(runId)) throw new Error('拒绝访问非本轮文件目录');
}
/** 所有表名均来自固定夹具白名单，数据库始终为本轮唯一值。 */
function table(name: string): string { assertTarget(); if (!allowedTables.has(name)) throw new Error('拒绝操作未声明的夹具表'); return qualified(database, name); }
/** 注册成功的真实连接以便失败时仍独立清理，认证仅来自进程环境。 */
async function raw(scoped = false): Promise<ManagedConnection> { assertTarget(); const value = await connect(scoped ? engineProfile : profile); rawConnections.add(value); return value; }

/** 旁观原驱动调用及原始回调，不替换网络、OK 包、错误或任何参数值。 */
function installDriverObserver(): void {
  const create = mysql.createConnection;
  const recording = vi.spyOn(mysql, 'createConnection').mockImplementation((options: Parameters<typeof mysql.createConnection>[0]) => {
    assertTarget();
    if (typeof options !== 'object' || options.host !== profile.host || Number(options.port) !== profile.port || (options.database !== undefined && options.database !== database)) throw new Error('真实驱动目标超出本轮夹具');
    const driver = create(options), record: DriverRecord = { driver, frames: [], scoped: options.database === database, nonStrict: false }; drivers.add(record);
    const methods = driver as unknown as Record<'query' | 'execute', DriverMethod>;
    const restoreMethods: (() => void)[] = [];
    for (const name of ['query', 'execute'] as const) {
      const original = methods[name];
      restoreMethods.push(() => { methods[name] = original; });
      methods[name] = function (...args: unknown[]) {
        const first = args[0], sql = typeof first === 'string' ? first : first && typeof first === 'object' && 'sql' in first ? String(first.sql) : '';
        const frame: Frame = { sql }; record.frames.push(frame);
        const observe = (error: unknown, result: unknown) => {
          if (error) frame.errorCode = String((error as { code?: unknown }).code ?? '未提供代码');
          if (result && typeof result === 'object' && 'warningStatus' in result) { frame.warningStatus = Number(result.warningStatus); frame.affectedRows = Number((result as { affectedRows?: number }).affectedRows); }
          if (Array.isArray(result)) {
            if (/@@SESSION\.sql_mode AS sqlMode/i.test(sql)) record.nonStrict = result.length === 1 && result[0]?.sqlMode === '';
            if (/^SHOW WARNINGS\b/i.test(sql)) frame.diagnosticCodes = result.map(row => Number(row.Code));
          }
        };
        const callback = args.at(-1);
        if (typeof callback === 'function') args[args.length - 1] = function (this: unknown, ...response: unknown[]) { observe(response[0], response[1]); return Reflect.apply(callback, this, response); };
        const command = Reflect.apply(original, driver, args) as Command;
        if (typeof callback !== 'function') { command.on('result', result => observe(undefined, result)); command.on('error', error => observe(error, undefined)); }
        return command;
      };
    }
    record.restoreMethods = () => restoreMethods.forEach(restore => restore());
    if (record.scoped) {
      // 只排入本轮专用会话；真实 SET 在连接初始化目录查询之前执行，从不设置 GLOBAL。
      record.initialized = new Promise<void>((accept, reject) => driver.query("SET SESSION sql_mode='',sql_notes=1,max_error_count=64", error => error ? reject(new Error('本轮专用会话模式初始化失败')) : accept()));
      void record.initialized.catch(() => undefined);
    }
    return driver;
  });
  restoreDrivers = () => recording.mockRestore();
}

/** 文件名只在本轮目录中生成，先独占创建再登记，避免覆盖或清理未知文件。 */
async function newFile(label: string, format: 'xlsx' | 'csv' | 'json'): Promise<string> {
  assertTarget(); if (!folderCreated || !/^[a-z][a-z0-9_-]*$/.test(label)) throw new Error('文件夹具尚未授权');
  const path = join(folder, `${label}-${randomUUID().replaceAll('-', '').slice(0, 8)}.${format}`);
  if (dirname(path) !== folder) throw new Error('文件路径越界');
  await writeFile(path, '', { flag: 'wx' }); files.add(path); return path;
}
/** 打开、预览和导入均只接受本轮已经登记的实际文件。 */
function assertFile(path: string): void { assertTarget(); if (!files.has(path) || dirname(path) !== folder) throw new Error('拒绝使用非本轮文件'); }
/** 外部工作簿独立生成原始文本，不利用生产导出器预先替被测校验器修正数据。 */
async function sourceFile(label: string, format: 'xlsx' | 'csv' | 'json', rows: { id: string; value: string }[]): Promise<string> {
  const path = await newFile(label, format);
  if (format === 'xlsx') { const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('数据'); sheet.addRow(['id', 'value']); rows.forEach(row => sheet.addRow([row.id, row.value])); await book.xlsx.writeFile(path); }
  else if (format === 'json') await writeFile(path, JSON.stringify(rows));
  else await writeFile(path, 'id,value\r\n' + rows.map(row => `${row.id},${row.value}`).join('\r\n') + '\r\n');
  return path;
}
/** 实际引擎入口处理路径与真实文件；主进程文件令牌的用户授权另由桌面验收覆盖。 */
async function importFile(name: string, path: string, format: 'xlsx' | 'csv' | 'json', columns: string[]) {
  table(name); assertFile(path); const before = new Set(drivers), taskId = randomUUID();
  const target = { connectionId: engineProfile.id, database, table: name, fileToken: randomUUID(), filePath: path, taskId };
  let result: { rows: number; errors: string[] };
  if (format === 'xlsx') {
    const sheets = await engine!.handle('excel.sheets', { fileToken: target.fileToken, filePath: path, taskId: randomUUID() });
    const preview = await engine!.handle('excel.preview', { fileToken: target.fileToken, filePath: path, taskId: randomUUID(), sheetId: sheets[0].id, protocol: 'dbark-v1' });
    result = await engine!.handle('excel.import', { ...target, sheetId: sheets[0].id, protocol: 'dbark-v1', fingerprint: preview.fingerprint, mapping: columns.map(column => ({ source: column, target: column })) });
  } else result = await engine!.handle('files.import', { ...target, format, encoding: 'utf8', mapping: Object.fromEntries(columns.map(column => [column, column])) });
  const used = [...drivers].filter(driver => !before.has(driver));
  expect(used.length).toBeGreaterThan(0); await Promise.all(used.map(driver => driver.initialized));
  expect(used.every(driver => driver.scoped && driver.nonStrict)).toBe(true);
  return { result, taskId, used, frames: used.flatMap(driver => driver.frames) };
}
/** 旁观连接只读已提交数据，不能借用引擎刚写入的事务来证明提交成功。 */
async function observed(sql: string, params: (string | number)[] = []) { return (await execute<Record<string, unknown>[]>(observer!, sql, params)).rows; }
/** 独立 COUNT 只证明已经提交的行数，不能读取导入连接的未提交状态。 */
async function rowCount(name: string): Promise<string> { return String((await observed(`SELECT COUNT(*) AS total FROM ${table(name)}`))[0].total); }

describe.skipIf(!enabled)('200 隔离库：真实引擎文件导入精度及警告', () => {
  beforeAll(async () => {
    assertTarget(); installDriverObserver();
    await mkdir(fileRoot, { recursive: true });
    if ((await lstat(fileRoot)).isSymbolicLink()) throw new Error('文件夹具根目录不得为链接');
    const within = relative(await realpath(process.cwd()), await realpath(fileRoot));
    if (within.startsWith('..') || isAbsolute(within)) throw new Error('文件夹具实际目录超出本克隆');
    await mkdir(folder); folderCreated = true;
    observer = await raw(); admin = await raw();
    globalMode = (await observed('SELECT @@GLOBAL.sql_mode AS value'))[0].value;
    expect(await observed('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE CAST(SCHEMA_NAME AS BINARY)=CAST(? AS BINARY)', [database])).toHaveLength(0);
    createAttempted = true; await execute(admin, `CREATE DATABASE ${identifier(database)} CHARACTER SET utf8mb4`);
    await execute(admin, `CREATE TABLE ${table('precision_source')} (id BIGINT UNSIGNED PRIMARY KEY,amount DECIMAL(40,18),happened DATETIME(6),payload BLOB,note VARCHAR(50),nil TEXT NULL) ENGINE=InnoDB`);
    for (const format of ['xlsx', 'csv', 'json']) await execute(admin, `CREATE TABLE ${table(`precision_${format}`)} LIKE ${table('precision_source')}`);
    for (const [name, type] of [['decimal_scale', 'DECIMAL(5,2)'], ['decimal_overflow', 'DECIMAL(5,2)'], ['short_text', 'VARCHAR(2)'], ['small_integer', 'TINYINT UNSIGNED'], ['short_time', 'DATETIME(3)'], ['fixed_float', 'FLOAT(5,1)'], ['fixed_double', 'DOUBLE(5,1)']] as const) await execute(admin, `CREATE TABLE ${table(name)} (id INT PRIMARY KEY,${identifier('value')} ${type}) ENGINE=InnoDB`);
    for (const format of ['xlsx', 'csv', 'json']) for (const kind of ['text', 'binary']) await execute(admin, `CREATE TABLE ${table(`bit_${kind}_${format}`)} (id INT PRIMARY KEY,${identifier('value')} BIT(64)) ENGINE=InnoDB`);
    await execute(admin, `CREATE TABLE ${table('warning_rows')} (id INT PRIMARY KEY,${identifier('value')} VARCHAR(30)) ENGINE=InnoDB`);
    await execute(admin, generatedWarningCreateSql(database));
    await execute(admin, timestampWarningCreateSql(database));
    for (const row of [
      ['18446744073709551615', '12345678901234567890.123456789012345678', '2026-10-16 10:20:30.123456', Buffer.from([0, 1, 255]), '=SUM(A1)', null],
      ['18446744073709551614', '0.000000000000000001', '2026-10-16 10:20:30.000001', Buffer.from([255, 0]), '\\N', ''],
    ] as (string | Buffer | null)[][]) { const result = await execute<ResultSetHeader>(admin, `INSERT INTO ${table('precision_source')} VALUES (?,?,?,?,?,?)`, row); expect(result.rows.warningStatus).toBe(0); }
    engine = new Engine(event => events.push(event)); const status = await engine.handle('connections.open', { id: engineProfile.id, profile: engineProfile });
    console.info(JSON.stringify({ 验收: '文件导入专项准备', 版本: status.version, 方言: status.dialect, 端口: profile.port, 隔离库: database, 非严格模式范围: '仅本轮专用连接' }));
  }, 60000);

  afterAll(async () => {
    const failures: string[] = [];
    /** 每项清理独立执行，前项失败不能跳过文件、其它连接或数据库残留核验。 */
    const step = async (label: string, action: () => Promise<void>) => { try { await action(); } catch { failures.push(label); } };
    try {
      await step('引擎关闭失败', async () => { await engine?.closeAll(); });
      for (const managed of rawConnections) if (managed !== observer) await step('本轮专用连接严格关闭失败', async () => { await managed.close({ strict: true }); });
      if (createAttempted && (!observer || observer.broken)) await step('旁观清理连接重建失败', async () => { observer = await raw(); });
      if (observer) {
        const ids = [...new Set([...drivers].filter(record => record.driver !== observer!.connection).map(record => record.driver.threadId).filter((id): id is number => Number.isSafeInteger(id) && (id ?? 0) > 0))];
        // 先核对正常收尾，随后才强制兜底；不能用兜底清理掩盖产品连接泄漏。
        if (ids.length) await step('正常收尾后仍有本轮真实线程', async () => { await expect.poll(() => observed('SELECT ID FROM information_schema.PROCESSLIST WHERE ID IN (' + ids.map(() => '?').join(',') + ')', ids), { timeout: 5000, interval: 50 }).toEqual([]); });
      }
      for (const record of drivers) if (record.driver !== observer?.connection) await step('真实驱动本地释放失败', () => closeMysqlConnection(record.driver, true, true));
      if (observer) {
        const ids = [...new Set([...drivers].filter(record => record.driver !== observer!.connection).map(record => record.driver.threadId).filter((id): id is number => Number.isSafeInteger(id) && (id ?? 0) > 0))];
        if (ids.length) {
          const remaining = () => observed('SELECT ID FROM information_schema.PROCESSLIST WHERE ID IN (' + ids.map(() => '?').join(',') + ')', ids);
          await step('本轮实际线程收尾失败', async () => {
            for (const row of await remaining()) { const id = Number(row.ID); if (!ids.includes(id)) throw new Error('拒绝清理非本轮线程'); await execute(observer!, `KILL CONNECTION ${id}`); }
            await expect.poll(remaining, { timeout: 5000, interval: 50 }).toEqual([]);
          });
          console.info(JSON.stringify({ 验收: '文件导入逐驱动清理', 本轮真实连接数量: ids.length, 旁观者自身排除: true }));
        }
        if (createAttempted) {
          await step('本轮随机库清理失败', async () => { assertTarget(); await execute(observer!, 'SET SESSION lock_wait_timeout=3'); await execute(observer!, `DROP DATABASE IF EXISTS ${identifier(database)}`); });
          await step('本轮随机库残留核验失败', async () => { expect(await observed('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE CAST(SCHEMA_NAME AS BINARY)=CAST(? AS BINARY)', [database])).toHaveLength(0); });
        }
        if (globalMode !== undefined) await step('全局模式未保持', async () => { expect((await observed('SELECT @@GLOBAL.sql_mode AS value'))[0].value).toBe(globalMode); });
      }
      if (folderCreated) {
        await step('本轮文件精确清理失败', async () => {
          assertTarget(); if ((await lstat(folder)).isSymbolicLink()) throw new Error('拒绝清理链接目录');
          for (const name of await readdir(folder)) {
            await step('本轮单文件清理失败', async () => {
              const path = join(folder, name), partial = [...files].some(file => name.startsWith(basename(file) + '.dbark-') && /\.dbark-[a-f0-9-]{36}\.partial$/.test(name));
              if ((!files.has(path) && !partial) || dirname(path) !== folder || !(await lstat(path)).isFile()) throw new Error('发现未登记文件，已保留');
              if (partial) failures.push('产品留下本轮 partial 临时文件');
              await rm(path);
            });
          }
          expect(await readdir(folder)).toEqual([]); await rmdir(folder);
        });
      }
      await step('专用会话初始化失败', async () => { await Promise.all([...drivers].map(record => record.initialized)); });
    } finally {
      try { for (const managed of rawConnections) if (managed === observer || managed.broken) await step('旁观连接严格关闭失败', async () => { await managed.close({ strict: true }); }); }
      finally { drivers.forEach(record => record.restoreMethods?.()); restoreDrivers?.(); }
    }
    if (failures.length) throw new Error(failures.join('；'));
  }, 60000);

  const rejectedValues = [
    { name: 'decimal_scale', value: '1.239' }, { name: 'decimal_overflow', value: '1000' }, { name: 'short_text', value: 'ABC' }, { name: 'small_integer', value: '256' },
    { name: 'fixed_float', value: '1.375' }, { name: 'fixed_double', value: '1.375' },
  ];
  for (const format of ['xlsx', 'csv', 'json'] as const) it.each(rejectedValues)(`${format} 在非严格专用会话预拒绝 $name，零写入零提交`, async ({ name, value }) => {
    const path = await sourceFile(`${name}-${format}`, format, [{ id: '1', value }]), attempt = await importFile(name, path, format, ['id', 'value']);
    expect(attempt.result.rows).toBe(0); expect(attempt.result.errors).toHaveLength(1); expect(attempt.result.errors[0]).toContain('不能无损导入');
    expect(attempt.frames.filter(frame => /^INSERT\b/i.test(frame.sql))).toHaveLength(0); expect(attempt.frames.some(frame => /^COMMIT\b/i.test(frame.sql))).toBe(false);
    expect(await rowCount(name)).toBe('0'); expect([...events].reverse().find(event => event.taskId === attempt.taskId)?.status).toBe('failed');
  });

  it('DATETIME 微秒缩减即使没有服务器警告也必须预拒绝', async () => {
    const path = await sourceFile('short-time', 'xlsx', [{ id: '1', value: '2026-10-16 10:20:30.123456' }]), attempt = await importFile('short_time', path, 'xlsx', ['id', 'value']);
    expect(attempt.result.errors[0]).toContain('时间精度'); expect(attempt.frames.some(frame => /^INSERT\b/i.test(frame.sql))).toBe(false); expect(await rowCount('short_time')).toBe('0');
  });

  for (const format of ['xlsx', 'csv', 'json'] as const) it(`${format} 真实导出再导入保留 BIGINT、DECIMAL、微秒、NULL、空串和二进制`, async () => {
    const path = await newFile(`roundtrip-${format}`, format), columns = ['id', 'amount', 'happened', 'payload', 'note', 'nil'];
    const target = { connectionId: engineProfile.id, database, table: 'precision_source', fileToken: randomUUID(), filePath: path, taskId: randomUUID() };
    const output = format === 'xlsx' ? await engine!.handle('excel.export', { ...target, scope: 'all' }) : await engine!.handle('files.export', { ...target, format, encoding: 'utf8', includeStructure: false, includeData: true });
    expect(output.rows).toBe(2);
    const attempt = await importFile(`precision_${format}`, path, format, columns); expect(attempt.result).toEqual({ rows: 2, errors: [] });
    const projection = `SELECT CAST(id AS CHAR) AS id,CAST(amount AS CHAR) AS amount,DATE_FORMAT(happened,'%Y-%m-%d %H:%i:%s.%f') AS happened,HEX(payload) AS payload,note,nil`;
    const source = await observed(`${projection} FROM ${table('precision_source')} ORDER BY id`);
    expect(source).toEqual([
      { id: '18446744073709551614', amount: '0.000000000000000001', happened: '2026-10-16 10:20:30.000001', payload: 'FF00', note: '\\N', nil: '' },
      { id: '18446744073709551615', amount: '12345678901234567890.123456789012345678', happened: '2026-10-16 10:20:30.123456', payload: '0001FF', note: '=SUM(A1)', nil: null },
    ]);
    expect(await observed(`${projection} FROM ${table(`precision_${format}`)} ORDER BY id`)).toEqual(source);
  });

  for (const format of ['xlsx', 'csv', 'json'] as const) it(`${format} BIT64 最大十进制文本与二进制导出协议均得到 FFFFFFFFFFFFFFFF`, async () => {
    const textTable = `bit_text_${format}`, binaryTable = `bit_binary_${format}`;
    const source = await sourceFile(`bit-text-${format}`, format, [{ id: '1', value: '18446744073709551615' }]);
    const first = await importFile(textTable, source, format, ['id', 'value']); expect(first.result).toEqual({ rows: 1, errors: [] });
    expect(await observed(`SELECT HEX(${identifier('value')}) AS bits FROM ${table(textTable)}`)).toEqual([{ bits: 'FFFFFFFFFFFFFFFF' }]);
    const path = await newFile(`bit-binary-${format}`, format), target = { connectionId: engineProfile.id, database, table: textTable, fileToken: randomUUID(), filePath: path, taskId: randomUUID() };
    const output = format === 'xlsx' ? await engine!.handle('excel.export', { ...target, scope: 'all' }) : await engine!.handle('files.export', { ...target, format, encoding: 'utf8', includeStructure: false, includeData: true });
    expect(output.rows).toBe(1);
    if (format === 'xlsx') { const book = new ExcelJS.Workbook(); await book.xlsx.readFile(path); expect(book.worksheets[0].getCell('B2').text).toBe('\\B://////////8='); }
    else if (format === 'csv') expect(await readFile(path, 'utf8')).toContain('base64://////////8=');
    else expect(JSON.parse(await readFile(path, 'utf8'))[0].value).toEqual({ type: 'binary', base64: '//////////8=' });
    const second = await importFile(binaryTable, path, format, ['id', 'value']); expect(second.result).toEqual({ rows: 1, errors: [] });
    expect(await observed(`SELECT HEX(${identifier('value')}) AS bits FROM ${table(binaryTable)}`)).toEqual([{ bits: 'FFFFFFFFFFFFFFFF' }]);
    expect([...first.frames, ...second.frames].filter(frame => /^INSERT\b/.test(frame.sql)).every(frame => frame.warningStatus === 0)).toBe(true);
  });

  it('实际探测合法 SIGNAL 01000 触发器的 OK 警告传播，不伪装跨版本支持', async () => {
    await execute(admin!, `CREATE TRIGGER ${qualified(database, 'warn_on_501')} BEFORE INSERT ON ${table('warning_rows')} FOR EACH ROW BEGIN IF NEW.id=501 THEN SIGNAL SQLSTATE '01000' SET MYSQL_ERRNO=1265,MESSAGE_TEXT='DBArk isolated warning'; END IF; END`);
    const probe = await raw(true); let warningStatus: number | null = null, state: 'ok' | 'warning-error' = 'ok';
    try {
      await execute(probe, 'START TRANSACTION');
      try { const result = await execute<ResultSetHeader>(probe, `INSERT INTO ${table('warning_rows')} VALUES (?,?)`, ['501', 'probe']); warningStatus = Number.isInteger(result.rows.warningStatus) ? result.rows.warningStatus : null; }
      catch (reason) { if ((reason as { sqlState?: string }).sqlState !== '01000') throw reason; state = 'warning-error'; }
      const diagnostics = (await execute<{ Code: number }[]>(probe, 'SHOW WARNINGS LIMIT 32')).rows;
      warningProbe = { okWarning: state === 'ok' && typeof warningStatus === 'number' && warningStatus > 0 && diagnostics.some(row => Number(row.Code) === 1265), warningStatus, diagnosticCodes: diagnostics.map(row => Number(row.Code)), state };
      console.info(JSON.stringify({ 验收: '触发器警告实际传播', ...warningProbe, 边界: warningProbe.okWarning ? '可执行真实 OK 警告回滚断言' : '该版本未观察到触发器可识别 OK 警告；保留此事实，另行探测生成列夹具' }));
    } finally { try { await execute(probe, 'ROLLBACK'); } finally { await probe.close({ strict: true }); } }
    expect(await rowCount('warning_rows')).toBe('0');
  });

  it('实际探测非严格专用会话生成列越界的 OK 警告，ERR 不冒充 OK', async () => {
    const probe = await raw(true);
    try { generatedWarningProbe = await probeGeneratedColumnWarning(probe, database); }
    finally { await probe.close({ strict: true }); }
    console.info(JSON.stringify({ 验收: '生成列越界警告实际传播', ...generatedWarningProbe, 边界: generatedWarningProbe.okWarning ? '实际观察到 OK 警告、1264 诊断及事务内 127，可用于批次回滚断言' : '本版本未取得可识别生成列 OK 警告；保留实际 OK/ERR 和诊断事实' }));
    expect(await rowCount(generatedWarningTableName)).toBe('0');
  });

  it('实际探测 TIMESTAMP(6) 日历合法但超存储范围的真实 OK 警告', async () => {
    const probe = await raw(true);
    try { timestampWarningProbe = await probeTimestampRangeWarning(probe, database); }
    finally { await probe.close({ strict: true }); }
    console.info(JSON.stringify({ 验收: '时间戳范围警告实际传播', ...timestampWarningProbe, 边界: timestampWarningProbe.okWarning ? '实际观察到 OK 警告及范围诊断，优先用于批次回滚断言' : '本版本未取得可识别时间戳 OK 警告；保留实际 OK/ERR 和诊断事实' }));
    expect(await rowCount(timestampWarningTableName)).toBe('0');
  });

  it('真实 OK 警告诊断先于下一条写入，回滚第 501 行且保留先前 500 行', async context => {
    if (!warningProbe || !generatedWarningProbe || !timestampWarningProbe) throw new Error('三种真实警告能力尚未全部探测');
    if (!warningProbe.okWarning && !generatedWarningProbe.okWarning && !timestampWarningProbe.okWarning) { console.info('时间戳、生成列和触发器均未提供可识别真实 OK 警告；本项未覆盖，不能计为警告保护通过。'); context.skip(); return; }
    // 优先使用普通用户字段的真实范围警告，其次生成列，最后使用实际传播成功的原触发器。
    const name = timestampWarningProbe.okWarning ? timestampWarningTableName : generatedWarningProbe.okWarning ? generatedWarningTableName : 'warning_rows';
    const diagnosticCodes = name === timestampWarningTableName ? timestampWarningProbe.diagnosticCodes.filter(code => code === 1264 || code === 1292) : [name === generatedWarningTableName ? 1264 : 1265];
    console.info(JSON.stringify({ 验收: '真实 OK 警告批次夹具选择', 来源: name, 诊断代码: diagnosticCodes, 原触发器状态: warningProbe }));
    const expectedValue = (id: number) => name === timestampWarningTableName ? id === 501 ? timestampWarningOverflowValue : timestampWarningSafeValue : `row-${id}`;
    const path = await sourceFile('warning-batch', 'xlsx', Array.from({ length: 502 }, (_, index) => ({ id: String(index + 1), value: expectedValue(index + 1) }))), attempt = await importFile(name, path, 'xlsx', ['id', 'value']);
    expect(attempt.result.rows).toBe(500); expect(attempt.result.errors).toHaveLength(1); expect(attempt.result.errors[0]).toContain('第 501'); expect(attempt.result.errors[0]).toContain('当前批 1 行已回滚');
    const frames = attempt.frames, inserts = frames.filter(frame => /^INSERT\b/i.test(frame.sql)); expect(inserts).toHaveLength(501); expect(inserts.at(-1)?.warningStatus).toBeGreaterThan(0);
    const warningAt = frames.indexOf(inserts.at(-1)!); expect(frames[warningAt + 1]?.sql).toBe('SHOW WARNINGS LIMIT 32'); expect(frames[warningAt + 1]?.diagnosticCodes?.some(code => diagnosticCodes.includes(code))).toBe(true);
    expect(frames.slice(warningAt + 2).map(frame => frame.sql)).toEqual(['ROLLBACK']); expect(frames.filter(frame => frame.sql === 'COMMIT')).toHaveLength(1);
    const actual = await observed(`SELECT id,CAST(${identifier('value')} AS CHAR) AS ${identifier('value')} FROM ${table(name)} ORDER BY id`); expect(actual).toHaveLength(500);
    expect(actual.map(row => [String(row.id), row.value])).toEqual(Array.from({ length: 500 }, (_, index) => [String(index + 1), expectedValue(index + 1)]));
    if (name === generatedWarningTableName) expect(await observed(`SELECT DISTINCT CAST(warning_guard AS CHAR) AS guard FROM ${table(name)}`)).toEqual([{ guard: '1' }]);
    expect([...events].reverse().find(event => event.taskId === attempt.taskId)?.status).toBe('failed');
  }, 60000);
});
