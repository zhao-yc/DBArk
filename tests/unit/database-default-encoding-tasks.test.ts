import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ManagedConnection } from '../../src/engine/connection';
import { DatabaseDefaultEncodingTasks } from '../../src/engine/databaseDefaultEncodingTasks';
import { StructurePatchCache, structureCacheLimits } from '../../src/engine/structurePatchCache';
import type { StructureTaskContext, StructureTaskHost, StructureTaskOptions } from '../../src/engine/structureDefinition';
import { databaseDefaultEncodingAcknowledgements, type DatabaseDefaultEncodingGetOutput, type DatabaseDefaultEncodingPreviewOutput } from '../../src/shared/databaseDefaultEncoding';
import type { TableEncodingPair } from '../../src/shared/tableDefaultEncoding';

const oldPair = { charset: 'utf8mb4', collation: 'utf8mb4_bin' }, nextPair = { charset: 'latin1', collation: 'latin1_swedish_ci' };
let tasks: DatabaseDefaultEncodingTasks, host: FakeHost, now: number, cache: StructurePatchCache;
let database: string, current: TableEncodingPair, version: string, dialect: 'mysql' | 'mariadb', uuid: string, mode: string, hostname: string, currentUser: string;
let sourceOverride: string | undefined, omitCollation: boolean, includeEncryption: boolean, schemaNames: string[], catalog: { charset: string; collation: string; compiled: string }[];
let warningStatus: unknown, affectedRows: unknown, warningRows: unknown, closeFails: boolean, fail: RegExp | undefined, hold: RegExp | undefined, cancelled: boolean, afterMutation: (() => void) | undefined;
let sent: string[], held: (() => void) | undefined, releaseClose: (() => void) | undefined;
/** 真实结构查询函数驱动替身；只替换网络及关闭，令牌、定义、目录和状态均运行产品实现。 */
class FakeHost implements StructureTaskHost {
  calls = 0; closed = 0; reports: unknown[] = []; waitClose = false;
  async run<T>(_connection: string, _taskId: string, action: (context: StructureTaskContext) => Promise<T>, options: StructureTaskOptions): Promise<T> {
    this.calls++; const connection = new EventEmitter();
    Object.assign(connection, { query(sql: string, callback: (error: Error | null, rows?: unknown, fields?: unknown[]) => void) {
      sent.push(sql);
      const complete = (): void => queueMicrotask(() => {
        if (fail?.test(sql)) { callback(Error('驱动拒绝')); return; }
        let rows: unknown;
        if (sql.startsWith('SELECT @@hostname')) rows = [{ hostname, port: '3306', serverId: '9007199254740993', currentUser, sqlMode: mode, lowerNames: 0 }];
        else if (sql.startsWith('SELECT @@server_uuid')) rows = [{ uuid }];
        else if (sql.startsWith('SELECT SCHEMA_NAME')) rows = schemaNames.map(name => ({ name, ...current }));
        else if (sql.startsWith('SHOW CREATE DATABASE')) rows = [{ Database: database, 'Create Database': sourceOverride ?? `CREATE DATABASE \`${database.replaceAll('`', '``')}\` /*!40100 DEFAULT CHARACTER SET ${current.charset}${omitCollation ? '' : ' COLLATE ' + current.collation} */${includeEncryption ? " /*!80016 DEFAULT ENCRYPTION='N' */" : ''}` }];
        else if (sql.startsWith('SELECT CHARACTER_SET_NAME')) rows = [{ ...current }];
        else if (sql.startsWith('SELECT c.CHARACTER_SET_NAME')) rows = structuredClone(catalog);
        else if (sql.includes("TABLE_NAME='COLLATION_CHARACTER_SET_APPLICABILITY'")) rows = ['CHARACTER_SET_NAME', 'COLLATION_NAME', 'FULL_COLLATION_NAME'].map(name => ({ name }));
        else if (sql.startsWith('SELECT a.CHARACTER_SET_NAME')) rows = [{ charset: 'utf8mb4', collation: 'utf8mb4_uca1400_ai_ci', compiled: 'Yes' }];
        else if (sql.startsWith('ALTER DATABASE')) { const match = /DEFAULT CHARACTER SET `([^`]+)` COLLATE `([^`]+)`/.exec(sql)!; current = { charset: match[1], collation: match[2] }; afterMutation?.(); rows = { affectedRows, warningStatus }; }
        else if (sql === 'SHOW WARNINGS LIMIT 20') rows = warningRows;
        else { callback(Error('测试未声明SQL：' + sql)); return; }
        callback(null, rows, []);
      });
      if (hold?.test(sql)) held = complete; else complete();
    } });
    const context: StructureTaskContext = { managed: { connection, broken: false, status: { version, dialect } } as unknown as ManagedConnection, checkCancelled() { if (cancelled) throw Error('任务已取消'); }, report: () => this.reports.push({ ...options.progress }), commandStarted: () => () => undefined };
    try { return await action(context); }
    finally { if (this.waitClose) await new Promise<void>(resolve => { releaseClose = resolve; }); if (closeFails) throw Error('关闭失败，资源未确认'); this.closed++; options.onResourcesReleased?.(); }
  }
}
async function get(name = database, revision = 1): Promise<DatabaseDefaultEncodingGetOutput> { return tasks.get({ connectionId: 'c', database: name, taskId: 'get' }, revision); }
async function preview(value: DatabaseDefaultEncodingGetOutput, pair = nextPair, revision = 1): Promise<DatabaseDefaultEncodingPreviewOutput> { return tasks.preview({ snapshotId: value.snapshotId, ...pair, taskId: 'preview' }, revision); }
async function apply(value: DatabaseDefaultEncodingPreviewOutput, confirmation = database, acks: string[] = [...databaseDefaultEncodingAcknowledgements], revision = 1) { return tasks.apply({ previewToken: value.previewToken, confirmation, acknowledgements: acks, taskId: 'apply' }, revision); }
beforeEach(() => {
  now = 1000; database = '新`库'; current = { ...oldPair }; version = '8.4.11'; dialect = 'mysql'; uuid = 'unit-server'; mode = ''; hostname = 'unit'; currentUser = 'unit@host';
  sourceOverride = undefined; omitCollation = false; includeEncryption = true; schemaNames = [database]; catalog = [{ ...oldPair, compiled: 'Yes' }, { ...nextPair, compiled: 'Yes' }];
  warningStatus = 0; affectedRows = 0; warningRows = [{ Code: 1234, Message: '服务器警告' }]; closeFails = false; fail = hold = undefined; cancelled = false; afterMutation = undefined; sent = []; held = releaseClose = undefined;
  host = new FakeHost(); cache = new StructurePatchCache(() => now); tasks = new DatabaseDefaultEncodingTasks(host, () => now, cache);
});
describe('数据库默认编码实际任务类与查询端口', () => {
  it('目录和SHOW CREATE交叉证明、预览只读、单条ALTER、不切库、不重述表列', async () => {
    const snapshot = await get(); expect(snapshot.writable, snapshot.reasons.join('')).toBe(true); expect(snapshot.current).toEqual(oldPair);
    expect(snapshot.warnings.join('')).toContain('ABA'); expect(snapshot.warnings.join('')).toContain('不转换');
    const value = await preview(snapshot); expect(value.sql).toBe('ALTER DATABASE `新``库` DEFAULT CHARACTER SET `latin1` COLLATE `latin1_swedish_ci`;');
    expect(sent.some(sql => /^(ALTER|CREATE|DROP|USE)/.test(sql))).toBe(false);
    expect(await apply(value)).toMatchObject({ target: { connectionId: 'c', database }, ddlCompleted: true, definitionVerified: true, before: oldPair, after: nextPair });
    expect(sent.filter(sql => sql.startsWith('ALTER'))).toEqual([value.sql]); expect(sent.some(sql => /^(USE|ALTER TABLE|SET)/.test(sql))).toBe(false); expect(host.calls).toBe(host.closed);
    await expect(apply(value)).rejects.toThrow('失效');
  });
  it.each(['5.7.44', '8.0.46', '8.4.11', '10.11.19-MariaDB', '11.4.13-MariaDB', '5.5.5-10.11.19-MariaDB'])('只允许已证明的精确版本%s，包含Maria兼容前缀', async value => {
    version = value; dialect = value.includes('MariaDB') ? 'mariadb' : 'mysql'; expect((await get()).writable).toBe(true); expect(await apply(await preview(await get()))).toMatchObject({ definitionVerified: true });
  });
  it.each(['5.7.43', '8.0.45', '8.4.12', '9.0.0', ''])('未知版本%s只读且不能预览', async value => { version = value; const snapshot = await get(); expect(snapshot.writable).toBe(false); await expect(preview(snapshot)).rejects.toThrow('只读'); });
  it('SHOW CREATE省略COLLATE时使用真实CHARACTER_SETS默认目录证明', async () => { omitCollation = true; expect((await get()).writable).toBe(true); expect(sent.some(sql => sql.startsWith('SELECT CHARACTER_SET_NAME'))).toBe(true); });
  it('MariaDB完整目录别名才可选择，未注册别名不能猜写', async () => { version = '11.4.13-MariaDB'; dialect = 'mariadb'; const snapshot = await get(); const alias = { charset: 'utf8mb4', collation: 'utf8mb4_uca1400_ai_ci' }; expect(snapshot.candidates).toContainEqual(alias); expect(await apply(await preview(snapshot, alias))).toMatchObject({ definitionVerified: true, after: alias }); });
  it('不完整可执行注释和多条定义不产生可执行快照', async () => {
    sourceOverride = `CREATE DATABASE \`${database.replaceAll('`', '``')}\` /*!40100 DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`;
    expect((await get()).writable).toBe(false); sourceOverride += ' */; DROP DATABASE `other`'; expect((await get()).writable).toBe(false);
  });
  it.each(['数据库名', '字符集', '排序规则', '未知附加属性', '定义预算'])('%s矛盾不生成可执行能力', async kind => {
    const name = database.replaceAll('`', '``');
    sourceOverride = kind === '数据库名' ? 'CREATE DATABASE `other` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin' : `CREATE DATABASE \`${name}\` DEFAULT CHARACTER SET ${kind === '字符集' ? 'latin1' : 'utf8mb4'} COLLATE ${kind === '排序规则' ? 'utf8mb4_general_ci' : 'utf8mb4_bin'}${kind === '未知附加属性' ? ' /*!99999 UNKNOWN OPTION */' : kind === '定义预算' ? ' '.repeat(65537) : ''}`;
    const snapshot = await get(); expect(snapshot.writable).toBe(false); await expect(preview(snapshot)).rejects.toThrow('只读');
  });
  it.each([{ names: [] }, { names: ['other'] }, { names: ['新`库', '新`库'] }])('实际SCHEMATA目标$names不存在或不唯一即拒绝', async ({ names }) => { schemaNames = names; await expect(get()).rejects.toThrow('目标数据库'); });
  it.each(['mysql', 'SYS', '', 'a.b', 'a/b', 'a\\b', '尾空格 ', '\u0000', '😀', 'x'.repeat(65)])('非法/系统库名%j在建连前拒绝', async name => { await expect(get(name)).rejects.toThrow(); expect(host.calls).toBe(0); });
  it('数据库单引号与反引号分别十六进制和标识符引用，永不插入字面SQL', async () => {
    database = "a'`库"; schemaNames = [database]; const value = await preview(await get()); expect(value.sql).toContain("`a'``库`"); expect(sent.find(sql => sql.startsWith('SELECT SCHEMA_NAME'))).toContain('CONVERT(X\''); expect(sent.find(sql => sql.startsWith('SELECT SCHEMA_NAME'))).not.toContain(database);
  });
  it('重复候选歧义、未编译、过量或失败目录都不能伪装完整能力', async () => {
    catalog = [{ ...oldPair, compiled: 'Yes' }, { ...oldPair, charset: 'latin1', compiled: 'Yes' }]; expect((await get()).writable).toBe(false);
    catalog = [{ ...oldPair, compiled: 'No' }]; expect((await get()).writable).toBe(false);
    catalog = Array.from({ length: 8193 }, () => ({ ...oldPair, compiled: 'Yes' })); expect((await get()).writable).toBe(false);
    fail = /^SELECT c.CHARACTER_SET_NAME/; expect((await get()).writable).toBe(false);
  });
  it('无变化与跨字符集配对、伪造SQL名称均拒绝且不建立预览会话', async () => {
    const snapshot = await get(), count = host.calls; await expect(preview(snapshot, oldPair)).rejects.toThrow('没有变化');
    await expect(preview(snapshot, { charset: 'latin1', collation: 'utf8mb4_bin' })).rejects.toThrow('配对');
    await expect(preview(snapshot, { charset: 'utf8mb4` DROP', collation: 'utf8mb4_bin' })).rejects.toThrow(); expect(host.calls).toBe(count);
  });
  it.each(['UUID', 'hostname', 'currentUser', 'sqlMode', '完整定义', '实际默认', '目录'])('预览前%s变化即拒绝', async kind => {
    const snapshot = await get(); if (kind === 'UUID') uuid = 'other'; if (kind === 'hostname') hostname = 'other'; if (kind === 'currentUser') currentUser = 'other@host'; if (kind === 'sqlMode') mode = 'ANSI_QUOTES'; if (kind === '完整定义') includeEncryption = false; if (kind === '实际默认') current = { ...nextPair }; if (kind === '目录') catalog.push({ charset: 'utf8mb4', collation: 'utf8mb4_general_ci', compiled: 'Yes' });
    await expect(preview(snapshot)).rejects.toThrow('已变化'); expect(sent.some(sql => sql.startsWith('ALTER'))).toBe(false);
  });
  it.each(['UUID', '模式', '定义', '默认', '目录', '修订'])('执行前%s变化消费令牌且零DDL', async kind => {
    const value = await preview(await get()); if (kind === 'UUID') uuid = 'other'; if (kind === '模式') mode = 'NO_BACKSLASH_ESCAPES'; if (kind === '定义') includeEncryption = false; if (kind === '默认') current = { ...nextPair }; if (kind === '目录') catalog.push({ charset: 'latin1', collation: 'latin1_bin', compiled: 'Yes' });
    await expect(apply(value, database, [...databaseDefaultEncodingAcknowledgements], kind === '修订' ? 2 : 1)).rejects.toThrow(); await expect(apply(value)).rejects.toThrow('失效'); expect(sent.some(sql => sql.startsWith('ALTER'))).toBe(false);
  });
  it.each(['名称', '缺项', '重复', '多项'])('%s确认不符同步消费令牌且不建连', async kind => {
    const value = await preview(await get()), calls = host.calls; let acks: string[] = [...databaseDefaultEncodingAcknowledgements]; if (kind === '缺项') acks.pop(); if (kind === '重复') acks[1] = acks[0]; if (kind === '多项') acks.push('unknown');
    await expect(apply(value, kind === '名称' ? database + ' ' : database, acks)).rejects.toThrow('确认'); expect(host.calls).toBe(calls); await expect(apply(value)).rejects.toThrow('失效');
  });
  it('TTL、缓存共享额度、不同用途隔离、release以及连接全局释放都生效', async () => {
    const snapshot = await get(), value = await preview(snapshot); now += structureCacheLimits.ttlMs; await expect(apply(value)).rejects.toThrow('失效'); await expect(preview(snapshot)).rejects.toThrow('失效');
    const latest = await get(), token = await preview(latest); tasks.releaseTokens({ snapshotId: latest.snapshotId }); await expect(apply(token)).rejects.toThrow('失效');
    const other = cache.scope<{ connectionId: string; bytes: number; expires: number }>('columns', 'snapshot', x => x); other.set('foreign', { connectionId: 'c', bytes: 10, expires: now + 100 }); tasks.releaseTokens({ snapshotId: 'foreign' }); expect(other.has('foreign')).toBe(true);
    cache.release('c'); expect(other.has('foreign')).toBe(false); for (let i = 0; i < 32; i++) other.set('s' + i, { connectionId: 'c', bytes: 1, expires: now + 100 }); await expect(get()).rejects.toThrow('上限');
  });
  it('读取关闭失败不发布快照，预览关闭失败不发布执行令牌', async () => {
    closeFails = true; await expect(get()).rejects.toThrow('关闭失败'); expect(cache.scope('databaseDefaultEncoding', 'snapshot', () => { throw Error('不使用'); }).size).toBe(0);
    closeFails = false; const snapshot = await get(); closeFails = true; await expect(preview(snapshot)).rejects.toThrow('关闭失败'); expect(cache.scope('databaseDefaultEncoding', 'preview', () => { throw Error('不使用'); }).size).toBe(0);
  });
  it('原预览动作或关闭期间释放快照使迟到预览失效', async () => {
    const snapshot = await get(); host.waitClose = true; const pending = preview(snapshot); await vi.waitFor(() => expect(releaseClose).toBeDefined()); tasks.releaseTokens({ snapshotId: snapshot.snapshotId }); releaseClose!(); await expect(pending).rejects.toThrow('释放');
  });
  it('动作和关闭间过期禁止迟到发布；取消后读取不能伪装完整候选', async () => {
    const snapshot = await get(); host.waitClose = true; const pending = preview(snapshot); await vi.waitFor(() => expect(releaseClose).toBeDefined()); now += structureCacheLimits.ttlMs; releaseClose!(); await expect(pending).rejects.toThrow('过期');
    host.waitClose = false; cancelled = true; await expect(get()).rejects.toThrow('取消');
  });
  it('同名同步占用，原动作尚未投递或资源尚未关闭均不可并行', async () => {
    const snapshot = await get(), a = await preview(snapshot), b = await preview(snapshot); hold = /^SELECT @@hostname/; const pending = apply(a); await vi.waitFor(() => expect(held).toBeDefined()); await expect(apply(b)).rejects.toThrow('真实资源');
    host.waitClose = true; hold = undefined; held!(); await vi.waitFor(() => expect(releaseClose).toBeDefined()); const latest = await getPendingIndependentSnapshot(); await expect(apply(latest)).rejects.toThrow('真实资源'); releaseClose!(); await pending;
    expect(sent.filter(sql => sql.startsWith('ALTER'))).toHaveLength(1);
  });
  it('关闭失败保留执行名称锁，不能因Promise拒绝就宣称资源释放', async () => {
    const snapshot = await get(), a = await preview(snapshot), b = await preview(snapshot); closeFails = true; await expect(apply(a)).rejects.toThrow('关闭失败'); closeFails = false; await expect(apply(b)).rejects.toThrow('失效'); const c = await preview(await get(), oldPair); await expect(apply(c)).rejects.toThrow('真实资源'); expect(sent.filter(sql => sql.startsWith('ALTER'))).toHaveLength(1);
  });
  it('仅显式已证明资源恢复的连接撤销可解除unknown锁；旧令牌不复活，另一连接能力不受影响', async () => {
    const original = await get(), first = await preview(original), oldOther = await preview(original);
    closeFails = true; await expect(apply(first)).rejects.toThrow('关闭失败'); closeFails = false;
    const retainedSnapshot = await get(), blocked = await preview(retainedSnapshot, oldPair); await expect(apply(blocked)).rejects.toThrow('真实资源');
    const peerSnapshot = await tasks.get({ connectionId: 'peer', database, taskId: 'peer-get' }, 1);
    const peerPreview = await tasks.preview({ snapshotId: peerSnapshot.snapshotId, ...oldPair, taskId: 'peer-preview' }, 1);
    const unrelated = cache.scope<{ connectionId: string; expires: number; bytes: number }>('columns', 'snapshot', value => value); unrelated.set('unrelated', { connectionId: 'c', expires: now + 1000, bytes: 1 });
    // 此调用只模拟Engine已核准的恢复通知；普通close失败和Promise拒绝不会自行触发它。
    tasks.releaseConnection('c'); expect(unrelated.has('unrelated')).toBe(true);
    await expect(apply(first)).rejects.toThrow('失效'); await expect(apply(oldOther)).rejects.toThrow('失效'); await expect(preview(original)).rejects.toThrow('失效'); await expect(preview(retainedSnapshot, oldPair)).rejects.toThrow('失效');
    expect(await apply(peerPreview)).toMatchObject({ definitionVerified: true, after: oldPair });
    const fresh = await preview(await get()); expect(await apply(fresh)).toMatchObject({ definitionVerified: true, after: nextPair }); expect(sent.filter(sql => sql.startsWith('ALTER'))).toHaveLength(3);
  });
  it('未知资源锁总数有32项硬上限，拒绝第33项不建连；显式释放只减本连接额度', async () => {
    const prepare = async (connectionId: string, pair = nextPair) => { const snapshot = await tasks.get({ connectionId, database, taskId: 'bounded-get' }, 1); return tasks.preview({ snapshotId: snapshot.snapshotId, ...pair, taskId: 'bounded-preview' }, 1); };
    for (let index = 0; index < 32; index++) { current = { ...oldPair }; const plan = await prepare('bounded-' + index); closeFails = true; await expect(apply(plan)).rejects.toThrow('关闭失败'); closeFails = false; }
    const overflow = await prepare('bounded-32', oldPair), calls = host.calls; await expect(apply(overflow)).rejects.toThrow('32项上限'); expect(host.calls).toBe(calls); await expect(apply(overflow)).rejects.toThrow('失效');
    tasks.releaseConnection('bounded-0'); const other = await prepare('bounded-1', oldPair); await expect(apply(other)).rejects.toThrow('真实资源');
    const fresh = await prepare('bounded-32', oldPair); expect(await apply(fresh)).toMatchObject({ definitionVerified: true }); expect(sent.filter(sql => sql.startsWith('ALTER'))).toHaveLength(33);
  });
  it.each([0, 1, undefined, -1, '0', 65536])('DDL警告计数%j严格核验并立即读取诊断', async count => {
    warningStatus = count; const result = await apply(await preview(await get())); expect(result.ddlCompleted).toBe(true); expect(result.definitionVerified).toBe(count === 0);
    const index = sent.findIndex(sql => sql.startsWith('ALTER')); if (count === 1) { expect(sent[index + 1]).toBe('SHOW WARNINGS LIMIT 20'); expect(result.warnings.join('')).toContain('服务器警告1234'); } else expect(sent[index + 1]).not.toBe('SHOW WARNINGS LIMIT 20');
  });
  it.each([0, 1])('ALTER成功header affectedRows=%j由完整后验再确认', async count => { affectedRows = count; expect(await apply(await preview(await get()))).toMatchObject({ ddlCompleted: true, definitionVerified: true }); });
  it.each([undefined, '0', -1, 2, NaN])('不可信affectedRows=%j保持unknown且消费原快照全部令牌', async count => { const snapshot = await get(), value = await preview(snapshot), other = await preview(snapshot); affectedRows = count; await expect(apply(value)).rejects.toThrow('可确认'); expect(host.reports.at(-1)).toMatchObject({ ddlSubmitted: true, ddlCompleted: false, outcome: 'unknown' }); await expect(apply(other)).rejects.toThrow('失效'); });
  it.each(['读取失败', '不是数组', '字段错误', '超量'])('服务器警告%s保留DDL成功但不伪核验', async kind => {
    warningStatus = 1; if (kind === '读取失败') fail = /^SHOW WARNINGS/; if (kind === '不是数组') warningRows = {}; if (kind === '字段错误') warningRows = [{ Code: '1', Message: '无效' }]; if (kind === '超量') warningRows = Array.from({ length: 21 }, () => ({ Code: 1234, Message: '警告' }));
    const result = await apply(await preview(await get())); expect(result).toMatchObject({ ddlCompleted: true, definitionVerified: false }); expect(result.warnings.join('')).toContain('未完整读取');
  });
  it.each(['取消', '后读失败', '属性变化', '身份变化', '目录变化', '实际默认不匹配'])('成功响应后的%s保留完成事实但不伪核验', async kind => {
    afterMutation = () => { if (kind === '取消') cancelled = true; if (kind === '后读失败') fail = /^SHOW CREATE/; if (kind === '属性变化') includeEncryption = false; if (kind === '身份变化') uuid = 'other'; if (kind === '目录变化') catalog.push({ charset: 'latin1', collation: 'latin1_bin', compiled: 'Yes' }); if (kind === '实际默认不匹配') current = { ...oldPair }; };
    const value = await preview(await get()); expect(await apply(value)).toMatchObject({ ddlCompleted: true, definitionVerified: false }); expect(host.reports.at(-1)).toMatchObject({ ddlSubmitted: true, ddlCompleted: true, outcome: 'succeeded' }); await expect(apply(value)).rejects.toThrow('失效');
  });
  it('DDL投递失败保留unknown且不自动重放，发送前取消保持not-sent', async () => {
    const snapshot = await get(), value = await preview(snapshot), other = await preview(snapshot); fail = /^ALTER/; await expect(apply(value)).rejects.toThrow('驱动拒绝'); expect(host.reports.at(-1)).toMatchObject({ ddlSubmitted: true, ddlCompleted: false, outcome: 'unknown' }); await expect(apply(value)).rejects.toThrow('失效'); await expect(apply(other)).rejects.toThrow('失效'); await expect(preview(snapshot)).rejects.toThrow('失效');
    fail = undefined; const next = await preview(await get()); cancelled = true; await expect(apply(next)).rejects.toThrow('取消'); expect(host.reports.at(-1)).toMatchObject({ ddlSubmitted: false, ddlCompleted: false, outcome: 'not-sent' }); expect(sent.filter(sql => sql.startsWith('ALTER'))).toHaveLength(1);
  });
});

/** 并行锁专项提前准备的第三令牌，避免在另一关闭门控上建立无关等待。 */
async function getPendingIndependentSnapshot(): Promise<DatabaseDefaultEncodingPreviewOutput> {
  // 原快照执行成功后已撤销；单测仅验证同步锁优先于建连，使用真实新快照/预览且暂时不门控其收尾。
  const original = host.waitClose; host.waitClose = false; const value = await preview(await get(), oldPair); host.waitClose = original; return value;
}
