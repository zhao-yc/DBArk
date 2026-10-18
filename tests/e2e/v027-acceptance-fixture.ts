import { randomUUID, createHash } from 'node:crypto';
import { open, lstat, realpath, readFile, readdir, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import mysql from 'mysql2';
import type { Connection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import type { TestInfo } from '@playwright/test';
import { test as desktopTest, expect, ownedDesktopResources, retainOwnedDesktopResources, confirmOwnedDesktopExit, dataDir, pageErrors } from './desktop-fixture';
import { closeMysqlConnection } from '../../src/engine/connection';
import { sealEditorIndentLaunchIdentity } from './editor-indentation-native-identity';
import { emptyDefaultFactSql, assertEmptyDefaultFacts } from '../helpers/tableCreateEmptyDefault';
import { bindV027Target, v027CaseNames, v027Lifetime, v027Resources } from '../helpers/v027Acceptance';

type Owner = ReturnType<typeof ownedDesktopResources>;
export interface V027Context {
  info: TestInfo; plan: ReturnType<typeof v027Resources>; files: string[]; life: ReturnType<typeof v027Lifetime>; records: object[]; journalPath: string; binding: ReturnType<typeof bindV027Target>;
  readonly connection: Connection; readonly owner: Owner;
  record(stage: string, extra?: { directory?: string }): Promise<void>; check(allowClosed?: boolean): void;
  step<T>(action: () => Promise<T>, allowClosed?: boolean): Promise<T>; facts(allowClosed?: boolean): Promise<void>; bindDesktop(): Promise<void>; createSchema(): Promise<void>; neighbor(allowClosed?: boolean): Promise<void>; writeInputs(bodies: string[]): Promise<void>; finish(verify: (closed: boolean) => Promise<void>, taskCount: number): Promise<void>; fixtureEnd(): Promise<void>;
}
const contexts = new WeakMap<TestInfo, V027Context>(); let halted = false;
/** 每个case独立准入；由启动guard依赖先执行，禁止桌面先于SQL指纹核验启动。 */
async function admission(info: TestInfo, options: { trace: unknown; screenshot: unknown; video: unknown }): Promise<V027Context> {
  if (halted || process.platform !== 'win32' || options.trace !== 'off' || options.screenshot !== 'off' || options.video !== 'off' || info.retry !== 0 || info.repeatEachIndex !== 0 || info.project.retries !== 0 || info.config.workers !== 1 || info.timeout !== 120000) throw Error('0.27真实验收未满足Root串行、无录制/重试和原期限条件');
  const kind = info.title === v027CaseNames[0] ? 'csv' : info.title === v027CaseNames[1] ? 'time' : undefined; if (!kind) throw Error('未知0.27真实场景');
  const binding = bindV027Target(() => process.env), plan = v027Resources(kind, randomUUID().replaceAll('-', ''), createHash('sha256').update(info.testId).digest('hex'));
  const life = v027Lifetime(info, binding, () => test.info(), () => { halted = true; retainOwnedDesktopResources(info); });
  const journalPath = info.outputPath('v027-ownership.ndjson'), records: object[] = []; let journalSize = 0, journalIdentity = '', owner: Owner | undefined, appClosed = false, schemaAck = false, plannedDirectory = '', directoryRemoved = false;
  const files = plan.files.map(name => join(dirname(journalPath), name)), identities = new Map<string, { dev: string; ino: string; hash: string }>();
  /** 只写固定阶段与无凭据资源身份；每次有界追加、核原文件，先记录再进行资源写。 */
  async function record(stage: string, extra: { directory?: string } = {}) {
    await life.step(async () => {
      if (!['planned', 'server-admitted', 'desktop-directory-planned', 'desktop-acquired', 'schema-created', 'files-created', 'app-closed', 'cleaned', 'desktop-cleaned'].includes(stage) || records.length >= 16 || extra.directory && extra.directory.length > 1024) throw Error('0.27资源登记超过固定范围');
      if (stage === 'desktop-directory-planned') {
        if (!extra.directory || dirname(resolve(extra.directory)) !== resolve(tmpdir()) || !/^dbark-e2e-[a-f0-9]{32}$/.test(basename(extra.directory)) || plannedDirectory && plannedDirectory !== extra.directory) throw Error('0.27原临时目录计划变化');
        plannedDirectory = extra.directory;
      }
      if (stage === 'desktop-cleaned' && (!appClosed || !directoryRemoved || !life.snapshot.complete)) throw Error('0.27原目录尚未核残留');
      const ownerCheck = () => { life.check(true); if (owner && stage !== 'desktop-cleaned') { const current = ownedDesktopResources(info); if (current.application !== owner.application || current.page !== owner.page || !['app-closed', 'cleaned'].includes(stage) && current.closed) throw Error('0.27资源登记所属窗口变化'); } };
      ownerCheck();
      const entry = { seq: records.length + 1, stage, ...(stage === 'planned' ? { ...plan, files, runNonce: binding.target.nonce } : {}), ...extra }, bytes = Buffer.from(JSON.stringify(entry) + '\n');
      if (journalSize + bytes.length > 16384) throw Error('0.27资源登记超过16KiB');
      const handle = await open(journalPath, records.length ? 'a' : 'wx', 0o600);
      let failed = false, originalFailure: unknown;
      try {
        // 已取得原句柄后，期限检查也须落在finally覆盖内；晚回仅允许关闭该句柄。
        life.check(true);
        const stat = await handle.stat(); life.check(true); const id = String(stat.dev) + ':' + String(stat.ino);
        if (!stat.isFile() || stat.nlink !== 1 || stat.size !== journalSize || journalIdentity && journalIdentity !== id) throw Error('0.27原登记文件身份变化');
        journalIdentity = id; await handle.writeFile(bytes); life.check(true); await handle.sync(); life.check(true);
      } catch (reason) { failed = true; originalFailure = reason; throw reason; }
      finally {
        try { await handle.close(); }
        catch (closeFailure) { if (failed) throw new AggregateError([originalFailure, closeFailure], '0.27登记失败且原句柄关闭失败', { cause: originalFailure }); throw closeFailure; }
      }
      ownerCheck(); const finalStat = await lstat(journalPath); ownerCheck();
      if (!finalStat.isFile() || finalStat.isSymbolicLink() || finalStat.nlink !== 1 || String(finalStat.dev) + ':' + String(finalStat.ino) !== journalIdentity || finalStat.size !== journalSize + bytes.length) throw Error('0.27登记路径身份或追加字节不符');
      journalSize += bytes.length; records.push(entry);
    }, true);
  }
  const ctx: V027Context = {
    info, plan, files, life, records, journalPath, binding,
    get connection(): Connection { if (!observer) throw Error('0.27原观察连接尚未建立'); return observer; },
    get owner(): Owner { if (!owner) throw Error('0.27原桌面owner尚未建立'); return owner; },
    record,
    check(allowClosed = false) {
      life.check();
      if (native && (native.stream !== originalStream || (observer as unknown as { connection?: unknown }).connection !== native)) { life.stop(); throw Error('0.27原观察连接/物理流被替换'); }
      if (owner) { const current = ownedDesktopResources(info); if (current.application !== owner.application || current.page !== owner.page || !allowClosed && current.closed) { life.stop(); throw Error('0.27原窗口归属变化或已关闭'); } }
    },
    async step<T>(action: () => Promise<T>, allowClosed = false): Promise<T> { ctx.check(allowClosed); return life.step(async () => { const value = await action(); ctx.check(allowClosed); return value; }); },
    async facts(allowClosed = false) {
      const [rows] = await ctx.step(() => ctx.connection.query<RowDataPacket[]>(emptyDefaultFactSql), allowClosed); assertEmptyDefaultFacts(rows, binding.target.uuid);
      const [page] = await ctx.step(() => ctx.connection.query<RowDataPacket[]>('SELECT @@innodb_page_size AS bytes,@@innodb_default_row_format AS format'), allowClosed); expect(page).toHaveLength(1); expect(Number(page[0].bytes)).toBe(16384); expect(String(page[0].format).toUpperCase()).toBe('DYNAMIC');
    },
    async bindDesktop() {
      owner = ownedDesktopResources(info); ctx.check();
      const actual = await ctx.step(() => owner!.application.evaluate(({ app }) => ({ executable: process.execPath, appPath: app.getAppPath(), resources: process.resourcesPath, packaged: app.isPackaged, pid: process.pid, version: app.getVersion() })));
      if (dataDir !== plannedDirectory) throw Error('0.27实际桌面目录与写前计划不符');
      if (actual.version !== '0.27.0') throw Error('0.27实际应用版本不符'); await ctx.step(() => identity!.assertActual(actual)); await ctx.step(() => identity!.assertCurrent());
      await record('desktop-acquired', { directory: dataDir });
    },
    async createSchema() {
      await ctx.facts(); const [before] = await ctx.step(() => ctx.connection.query<RowDataPacket[]>('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [plan.schema])); expect(before).toHaveLength(0);
      const [ack] = await ctx.step(() => ctx.connection.query<ResultSetHeader>('CREATE DATABASE `' + plan.schema + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin')); expect(ack.affectedRows).toBe(1); expect(ack.warningStatus).toBe(0); schemaAck = true; await record('schema-created');
      await ctx.step(() => ctx.connection.query('CREATE TABLE `' + plan.schema + '`.`__v027_owner` (nonce CHAR(32) PRIMARY KEY,case_hash CHAR(64) NOT NULL) ENGINE=InnoDB'));
      await ctx.step(() => ctx.connection.execute('INSERT INTO `' + plan.schema + '`.`__v027_owner` VALUES (?,?)', [plan.nonce, plan.caseHash]));
      await ctx.step(() => ctx.connection.query('CREATE TABLE `' + plan.schema + '`.`neighbor` (id BIGINT PRIMARY KEY,note VARCHAR(64),payload BLOB) ENGINE=InnoDB'));
      await ctx.step(() => ctx.connection.execute('INSERT INTO `' + plan.schema + '`.`neighbor` VALUES (7,?,?)', ['旁行不变', Buffer.from([0, 255, 16])]));
    },
    async neighbor(allowClosed = false) { const [rows] = await ctx.step(() => ctx.connection.query<RowDataPacket[]>('SELECT CAST(id AS CHAR) AS id,note,HEX(payload) AS payload FROM `' + plan.schema + '`.`neighbor` ORDER BY id'), allowClosed); expect(rows).toEqual([{ id: '7', note: '旁行不变', payload: '00FF10' }]); },
    async writeInputs(bodies: string[]) {
      if (bodies.length !== files.length) throw Error('0.27文件样本数量不符');
      for (const [index, path] of files.entries()) await ctx.step(async () => {
        const handle = await open(path, 'wx', 0o600);
        let failed = false, originalFailure: unknown;
        try {
          // open晚回仍释放原句柄，不因停链继续写入、sync或登记后续资源。
          life.check(); await handle.writeFile(bodies[index]); life.check(); await handle.sync(); life.check(); const stat = await handle.stat(); life.check(); identities.set(path, { dev: String(stat.dev), ino: String(stat.ino), hash: createHash('sha256').update(bodies[index]).digest('hex') });
        } catch (reason) { failed = true; originalFailure = reason; throw reason; }
        finally {
          try { await handle.close(); }
          catch (closeFailure) { if (failed) throw new AggregateError([originalFailure, closeFailure], '0.27样本写入失败且原句柄关闭失败', { cause: originalFailure }); throw closeFailure; }
        }
      });
      await record('files-created');
    },
    async finish(verify: (closed: boolean) => Promise<void>, taskCount: number) {
      const tasks = await ctx.step(() => owner!.page.evaluate(() => window.dbark.invoke('tasks.list', {}))); expect(tasks).toHaveLength(taskCount); expect(tasks.every(task => task.status === 'completed')).toBe(true); expect(pageErrors).toEqual([]);
      await verify(false); await ctx.step(() => confirmOwnedDesktopExit(info), true); appClosed = ownedDesktopResources(info).closed; if (!appClosed) throw Error('0.27原应用未正常退出'); await record('app-closed');
      await ctx.facts(true); await verify(true);
      if (!schemaAck || !appClosed) throw Error('0.27隔离库创建ACK或正常退出未知');
      const [marker] = await ctx.step(() => ctx.connection.query<RowDataPacket[]>('SELECT nonce,case_hash FROM `' + plan.schema + '`.`__v027_owner`'), true); expect(marker).toEqual([{ nonce: plan.nonce, case_hash: plan.caseHash }]);
      const [tables] = await ctx.step(() => ctx.connection.query<RowDataPacket[]>('SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA=? ORDER BY TABLE_NAME', [plan.schema]), true); expect(tables.map(row => row.name).sort()).toEqual([...plan.tables].sort());
      for (const path of files) await ctx.step(async () => {
        const expected = identities.get(path), stat = await lstat(path); ctx.check(true);
        /** 每次只接受首次写入的同一文件；内容相同不能代替dev/ino、链接与路径身份。 */
        const assertOriginal = (value: typeof stat) => { if (!expected || !value.isFile() || value.isSymbolicLink() || value.nlink !== 1 || String(value.dev) !== expected.dev || String(value.ino) !== expected.ino || value.size < 0 || value.size > 8192) throw Error('0.27原样本文件归属未知'); };
        assertOriginal(stat);
        const beforePath = await realpath(path); ctx.check(true); if (beforePath !== resolve(path)) throw Error('0.27原样本文件规范路径变化');
        const bytes = await readFile(path); ctx.check(true); if (createHash('sha256').update(bytes).digest('hex') !== expected!.hash) throw Error('0.27样本文件字节变化');
        // readFile及realpath均可等待；删除前再核原路径和身份，漂移即停链，普通unlink不声称原子CAS。
        const afterPath = await realpath(path); ctx.check(true); if (afterPath !== resolve(path)) throw Error('0.27原样本文件规范路径变化');
        const after = await lstat(path); ctx.check(true); assertOriginal(after); if (after.size !== bytes.length) throw Error('0.27原样本文件长度变化');
        await unlink(path); ctx.check(true);
        try { await lstat(path); throw Error('0.27样本文件仍残留'); } catch (reason) { ctx.check(true); if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') throw reason; }
      }, true);
      await ctx.step(() => ctx.connection.query('DROP DATABASE `' + plan.schema + '`'), true);
      const [remaining] = await ctx.step(() => ctx.connection.query<RowDataPacket[]>('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [plan.schema]), true); expect(remaining).toHaveLength(0);
      await ctx.step(async () => { const stream = originalStream; await closeMysqlConnection(native!, true); ctx.check(true); if (native!.stream !== stream || !stream || (stream as { closed?: boolean }).closed !== true) throw Error('0.27原观察连接正常close未确认'); }, true);
      await record('cleaned'); life.finish();
    },
    async fixtureEnd() {
      life.check(true);
      if (!life.snapshot.complete || !appClosed || !plannedDirectory) { life.stop(); throw Error('0.27原收尾未完成'); }
      await life.step(async () => {
        try { await lstat(plannedDirectory); throw Error('0.27原桌面临时目录仍残留'); }
        catch (reason) { life.check(true); if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') throw reason; }
        directoryRemoved = true;
      }, true);
      await record('desktop-cleaned'); life.fixtureEnd();
    },
  };
  type Native = ReturnType<typeof mysql.createConnection> & { stream: any };
  let native: Native | undefined, originalStream: any, observer: Connection | undefined, identity: Awaited<ReturnType<typeof sealEditorIndentLaunchIdentity>> | undefined;
  contexts.set(info, ctx);
  try {
    await record('planned');
    life.check(); native = mysql.createConnection({ host: binding.target.host, port: binding.target.port, user: binding.target.user, password: binding.target.password, charset: 'utf8mb4', supportBigNumbers: true, bigNumberStrings: true, dateStrings: true, connectTimeout: 10000 }) as unknown as Native;
    originalStream = native.stream; if (!originalStream) throw Error('0.27原驱动物理流缺失');
    observer = native.promise();
    await ctx.step(() => new Promise<void>((yes, no) => native!.connect(error => error ? no(error) : yes()))); await ctx.facts(); await record('server-admitted');
    identity = await ctx.step(() => sealEditorIndentLaunchIdentity(binding.target.manifest, binding.target.sha256, resolve(__dirname, '../..'), { stat: async path => { const stat = await lstat(path); return { file: stat.isFile(), directory: stat.isDirectory(), link: stat.isSymbolicLink() }; }, real: realpath, list: readdir, bytes: readFile }, () => life.check(true)));
    if (identity.manifest.kind === 'source' ? Object.hasOwn(process.env, 'DBARK_EXECUTABLE_PATH') : resolve(process.env.DBARK_EXECUTABLE_PATH ?? '') !== identity.manifest.executable) throw Error('0.27原桌面启动参数与批准清单不符');
    return ctx;
  } catch (reason) { life.stop(); throw reason; }
}

/** 准入作为guard依赖先于原auto桌面fixture；原fixture仍独占退出/PID/临时目录清理权。 */
export const test = desktopTest.extend<{ v027Admission: V027Context }>({
  v027Admission: async ({ trace, screenshot, video }, use, info) => {
    const ctx = await admission(info, { trace, screenshot, video });
    try { await use(ctx); } finally { await ctx.fixtureEnd(); }
  },
  ownedDesktopLaunchGuard: async ({ v027Admission: ctx }, use) => {
    await use({ assertCurrent: () => ctx.binding.assertCurrent(), assertPreparation(info) { if (info !== ctx.info) throw Error('0.27原TestInfo变化'); ctx.life.check(true); }, async beforeDirectoryCreate(info, directory) { if (info !== ctx.info || basename(directory).length > 80) throw Error('0.27原临时目录登记身份变化'); await ctx.record('desktop-directory-planned', { directory }); } });
  },
});
export { expect };
/** 总是保留有界资源记录；失败、超时或主体未完成时只停链，不发起补清理。 */
export async function v027AfterEach(info: TestInfo) {
  const ctx = contexts.get(info); if (!ctx) { halted = true; retainOwnedDesktopResources(info); return; }
  ctx.life.endBody();
  try { await info.attach('0.27资源归属', { body: Buffer.from(JSON.stringify(ctx.records)), contentType: 'application/json' }); }
  catch (attachment) { if (info.errors.length) throw new AggregateError([...info.errors, attachment], '0.27原用例与资源附件均失败', { cause: info.errors[0] }); throw attachment; }
}
