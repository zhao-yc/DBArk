import { EventEmitter } from 'node:events';
import { Types } from 'mysql2';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TableInfo } from '../../src/shared/contracts';
import type { StructureTaskContext } from '../../src/engine/structureDefinition';
import { tableValueOptionsMessages as text } from '../../src/shared/tableValueOptions';

const ports = vi.hoisted(() => ({ readSource: vi.fn(), query: vi.fn() }));
/** 目录与短查询为RAM端口；分组仍经过真实consumeQueryFrames的execute、背压、帧边界和终态。 */
vi.mock('../../src/engine/incomingReferences', async () => ({ ...await vi.importActual('../../src/engine/incomingReferences'), readIncomingReferenceTable: ports.readSource }));
vi.mock('../../src/engine/structureDefinition', async () => ({ ...await vi.importActual('../../src/engine/structureDefinition'), structureTaskQuery: ports.query }));
import { readTableValueOptions, readTableValueOptionsServerIdentity } from '../../src/engine/tableValueOptions';

const input = { connectionId: 'memory', database: 'db', table: 'subject', column: 'label', filters: [], taskId: 'value-options-memory' };
const controls = ['SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ', 'SET SESSION max_sort_length = 262144', 'SET SESSION sort_buffer_size = 8388608', 'START TRANSACTION READ ONLY', 'ROLLBACK AND NO CHAIN NO RELEASE'];
const originalSource = (): TableInfo => ({ database: 'db', name: 'subject', objectKind: 'table', engine: 'InnoDB', charset: 'utf8mb4', collation: 'utf8mb4_general_ci', columns: [{ name: 'label', type: 'VARCHAR(100)', nullable: true, defaultValue: null, generated: false, extra: '', comment: '', characterSet: 'utf8mb4' }], indexes: [], foreignKeys: [], primaryKey: [], editableKey: [], ddl: 'CREATE TABLE `subject` (`label` varchar(100) DEFAULT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci' });
const server = () => ({ version: '8.4.11', hostname: 'memory-server', port: '3306', serverId: '1', currentUser: 'memory@localhost', connectionId: '42', lowerNames: '0', sqlMode: '', charset: 'utf8mb4', collation: 'utf8mb4_bin', quoteShowCreate: '1', maxSortLength: '262144', sortBufferSize: '8388608', uuid: 'f4cf2aa8-c730-11f1-8b89-223553c03441' });
let sent: string[], source: TableInfo, sourceReads: number, afterSource: TableInfo | undefined, rowValues: unknown[][], warnings: unknown[], eofWarnings: number | undefined, identityReads: number, identityPatch: ((value: Record<string, unknown>) => Record<string, unknown>) | undefined;
let aliases: string[], extraResults: boolean, failure: Error | undefined, held: boolean, cancelled: boolean, ended: boolean, pumpEnd: (() => void) | undefined, afterRow: (() => void) | undefined, context: StructureTaskContext, stop: ReturnType<typeof vi.fn>;
let internalUnsupportedDesign: boolean | undefined;

/** 一次只泵出原事件队列；pause/resume由真实消费者驱动，不用返回成品回包替代协议。 */
function connection() {
  const value = new EventEmitter(); let paused = false, pumping = false, current: EventEmitter | undefined;
  const queue: (() => void)[] = [];
  const pump = () => { if (pumping || held) return; pumping = true; try { while (!paused && queue.length) queue.shift()!(); } finally { pumping = false; } };
  const execute = (options: { sql: string }) => {
    const command = current = new EventEmitter(); sent.push(options.sql); ended = false;
    queue.push(() => command.emit('fields', aliases.map((name, index) => ({ name, columnType: index === 0 && typeof rowValues[0]?.[0] === 'number' ? Types.DOUBLE : Types.VAR_STRING })), 0));
    // 三列普通样本手写同一组/代表长度；组内最大长度的对抗样本显式提供第四列。
    for (const row of rowValues) queue.push(() => { command.emit('result', row.length === 3 ? [...row, row[2]] : row, 0); afterRow?.(); });
    if (failure) queue.push(() => command.emit('error', failure));
    queue.push(() => value.emit('dbark:session-state', { sql: options.sql, warningStatus: eofWarnings }));
    if (extraResults) queue.push(() => command.emit('fields', aliases.map(name => ({ name, columnType: Types.VAR_STRING })), 1), () => command.emit('result', ['x', '1', '1', '1'], 1), () => value.emit('dbark:session-state', { sql: options.sql, warningStatus: eofWarnings }));
    queue.push(() => { ended = true; command.emit('end'); });
    pumpEnd = () => { held = false; queue.splice(0); ended = true; queueMicrotask(() => { command.emit('error', Error('原分组已取消')); command.emit('end'); }); };
    queueMicrotask(pump); return command;
  };
  return Object.assign(value, { threadId: 42, pause() { paused = true; }, resume() { paused = false; pump(); }, execute: vi.fn(execute), query: vi.fn(() => { throw Error('禁止文本协议'); }), destroy() { if (current && !ended) { ended = true; current.emit('end'); } }, stream: {} });
}

beforeEach(() => {
  sent = []; source = originalSource(); sourceReads = identityReads = 0; afterSource = undefined; rowValues = [[null, '18446744073709551615', null], ['Alpha', '3', '5'], ['中', '1', '3']]; warnings = []; eofWarnings = 0; identityPatch = undefined; aliases = ['value', 'count', 'valueBytes', 'groupBytes']; extraResults = held = cancelled = ended = false; failure = undefined; pumpEnd = afterRow = undefined;
  internalUnsupportedDesign = undefined;
  const original = connection(); context = { managed: { connection: original, sqlMode: '', status: { version: '8.4.11', dialect: 'mysql' }, broken: false }, checkCancelled() { if (cancelled) throw Error('任务已取消'); }, commandStarted: vi.fn(() => vi.fn()), report: vi.fn() } as unknown as StructureTaskContext;
  stop = vi.fn(async () => { pumpEnd?.(); });
  ports.readSource.mockReset().mockImplementation(async () => { sent.push('READ SOURCE'); const metadata = structuredClone(++sourceReads > 1 && afterSource ? afterSource : source); if (internalUnsupportedDesign !== undefined) Object.defineProperty(metadata, 'unsupportedDesign', { value: internalUnsupportedDesign, enumerable: false }); return metadata; });
  ports.query.mockReset().mockImplementation(async (_context, sql: string) => {
    sent.push(sql);
    if (controls.includes(sql)) return { rows: { affectedRows: 0 }, fields: [] };
    if (sql === 'SHOW WARNINGS LIMIT 21') return { rows: warnings, fields: [] };
    if (sql.startsWith('SELECT @@version AS version')) { const value = server(); if (context.managed.status.dialect === 'mariadb') { value.version = context.managed.status.version; (value as Record<string, unknown>).uuid = null; } return { rows: [++identityReads > 1 && identityPatch ? identityPatch(value) : value], fields: [] }; }
    throw Error('RAM未登记短SQL');
  });
});

describe('不同值独立只读事务、原binary流与全部前后证据', () => {
  it('binary execute真实帧包含NULL组及精确COUNT，前后目录和身份通过后显式ROLLBACK', async () => {
    const result = await readTableValueOptions(context, input, stop);
    expect(result.values).toEqual([{ value: null, count: '18446744073709551615' }, { value: 'Alpha', count: '3' }, { value: '中', count: '1' }]);
    expect(result.truncated).toBe(false); expect(result.sourceDigest).toMatch(/^[a-f0-9]{64}$/); expect(result.source).toEqual(source); expect(result.warnings).toContain(text.equality);
    expect(sent.slice(0, 4)).toEqual(controls.slice(0, 4)); expect(sent.at(-1)).toBe(controls[4]);
    const index = sent.findIndex(sql => sql.startsWith('SELECT CASE')); expect(sent[index + 1]).toBe('SHOW WARNINGS LIMIT 21');
    expect(sourceReads).toBe(2); expect(identityReads).toBe(2); expect(context.managed.connection.execute).toHaveBeenCalledOnce(); expect(context.managed.connection.query).not.toHaveBeenCalled(); expect(stop).not.toHaveBeenCalled();
  });
  it('空匹配集为零候选，不伪造COUNT0或NULL组', async () => {
    rowValues = []; const result = await readTableValueOptions(context, input, stop); expect(result.values).toEqual([]); expect(result.truncated).toBe(false);
  });
  it.each([false, true])('真实metadata内部nonenumerable unsupportedDesign=%s不进入公开回执，原定义核验仍完成', async flag => {
    internalUnsupportedDesign = flag;
    const result = await readTableValueOptions(context, input, stop);
    expect(result.source).toEqual(source); expect(Object.hasOwn(result.source, 'unsupportedDesign')).toBe(false);
    const actualSources = ports.readSource.mock.results; expect(actualSources).toHaveLength(2);
    for (const call of actualSources) { const metadata = await call.value; expect(Object.getOwnPropertyDescriptor(metadata, 'unsupportedDesign')).toMatchObject({ value: flag, enumerable: false }); }
    expect(result.values).toHaveLength(3); expect(sourceReads).toBe(2); expect(identityReads).toBe(2);
  });
  it('501st仅探测截断但也完整验证，返回最多500、计数不失精度', async () => {
    rowValues = Array.from({ length: 501 }, (_, index) => [String(index), '9007199254740993', String(String(index).length)]);
    const result = await readTableValueOptions(context, input, stop); expect(result.values).toHaveLength(500); expect(result.values[499]).toEqual({ value: '499', count: '9007199254740993' }); expect(result.truncated).toBe(true); expect(result.warnings).toContain(text.truncated);
    rowValues[500] = [null, '1', '262145']; await expect(readTableValueOptions(context, input, stop)).rejects.toThrow('预算');
  });
  it('500组不能自行声称截断；超过501实际帧必须取消而不是悄悄忽略', async () => {
    rowValues = Array.from({ length: 500 }, (_, index) => [String(index), '1', String(String(index).length)]); expect((await readTableValueOptions(context, input, stop)).truncated).toBe(false);
    rowValues.push(['500', '1', '3'], ['501', '1', '3']); await expect(readTableValueOptions(context, input, stop)).rejects.toThrow(); expect(stop).toHaveBeenCalled();
  });
  it('PAD SPACE等价组代表长度可小于MAX，但超长成员必使整批拒收', async () => {
    rowValues = [['A', '2', '1', '2']]; expect((await readTableValueOptions(context, input, stop)).values).toEqual([{ value: 'A', count: '2' }]);
    rowValues = [[null, '2', '262144', '262145']]; await expect(readTableValueOptions(context, input, stop)).rejects.toThrow('预算');
  });
  it('会话排序前缀或缓冲设置被服务器截小，零分组、不回退到默认1024', async () => {
    const original = ports.query.getMockImplementation()!;
    ports.query.mockImplementation(async (...args: unknown[]) => { const result = await original(...args); if (String(args[1]).startsWith('SELECT @@version AS version')) result.rows[0].maxSortLength = '1024'; return result; });
    await expect(readTableValueOptions(context, input, stop)).rejects.toThrow(); expect(sent.some(sql => sql.startsWith('SELECT CASE'))).toBe(false);
    expect(sent.filter(sql => sql === controls[1])).toHaveLength(1);
  });
  it('不在客户端按casefold或raw distinct重组服务器分组，原计数保持', async () => {
    rowValues = [['Alpha', '4', '5'], ['alpha', '2', '5']]; const result = await readTableValueOptions(context, input, stop); expect(result.values).toEqual([{ value: 'Alpha', count: '4' }, { value: 'alpha', count: '2' }]);
  });
  it('浮点采用原binary宽化值，不能被文本0.1或CHAR替代', async () => {
    source.columns[0].type = 'FLOAT'; source.ddl = 'CREATE TABLE `subject` (`label` float) ENGINE=InnoDB'; rowValues = [[Math.fround(0.1), '4', '3'], [Math.fround(1e-30), '1', '5']];
    const result = await readTableValueOptions(context, input, stop); expect(result.values[0].value).toBe(0.10000000149011612); expect(result.values[1].value).toBe(Math.fround(1e-30)); expect(result.warnings).toContain(text.approximate);
    rowValues = [['0.1', '4', '3']]; await expect(readTableValueOptions(context, input, stop)).rejects.toThrow();
  });
  it('原服务器LIKE可搜索当前500组之外；不本地筛减且非空来源回传原模式', async () => {
    rowValues = [['zz_after_500', '2', '12']]; const result = await readTableValueOptions(context, { ...input, searchPattern: '%after_500%' }, stop);
    expect(result.values).toEqual([{ value: 'zz_after_500', count: '2' }]); expect(result.searchPattern).toBe('%after_500%'); expect(sent.find(sql => sql.startsWith('SELECT CASE'))).toContain("LIKE _utf8mb4 X'2561667465725f35303025'");
  });
  it.each([undefined, 1, 65535])('原EOF警告状态%j未知或非0不发布且诊断保留在相邻位置', async count => {
    eofWarnings = count; await expect(readTableValueOptions(context, input, stop)).rejects.toThrow('警告'); expect(sourceReads).toBe(1); expect(identityReads).toBe(1); expect(sent).not.toContain(controls[4]);
  });
  it('任何真实warning/note均拒绝完整回包，不从后续元数据误判已清空', async () => {
    warnings = [{ Level: 'Warning', Code: 1265, Message: '合成截断' }]; await expect(readTableValueOptions(context, input, stop)).rejects.toThrow('警告'); expect(sourceReads).toBe(1);
  });
  it('原表完整DDL或元数据发生变化，不能把先前值绑给新对象', async () => {
    afterSource = { ...source, ddl: source.ddl + " COMMENT='changed'" }; await expect(readTableValueOptions(context, input, stop)).rejects.toThrow('变化');
    sourceReads = 0; afterSource = { ...source, columns: [{ ...source.columns[0], comment: 'changed' }] }; await expect(readTableValueOptions(context, input, stop)).rejects.toThrow('变化'); expect(sent).not.toContain(controls[4]);
  });
  it.each(['hostname', 'serverId', 'currentUser', 'sqlMode', 'uuid'])('原服务器身份%s漂移不能发布候选', async field => {
    identityPatch = value => ({ ...value, [field]: field === 'uuid' ? 'a4cf2aa8-c730-11f1-8b89-223553c03441' : String(value[field]) + 'CHANGED' }); await expect(readTableValueOptions(context, input, stop)).rejects.toThrow(); expect(sent).not.toContain(controls[4]);
  });
  it('VIEW绑定完整定义，保留可选undefined字符集，仍不能把未知kind当表', async () => {
    source.objectKind = 'view'; source.engine = ''; source.charset = source.collation = undefined; source.ddl = 'CREATE VIEW `subject` AS SELECT `label` FROM `db`.`base`';
    const result = await readTableValueOptions(context, input, stop); expect(result.source.objectKind).toBe('view');
    source.objectKind = undefined; await expect(readTableValueOptions(context, input, stop)).rejects.toThrow();
  });
  it('错字段/多结果/重复原值/非预期状态帧都中止原命令而不发布部分列表', async () => {
    aliases = ['value', 'count', 'forgedBytes']; await expect(readTableValueOptions(context, input, stop)).rejects.toThrow();
    aliases = ['value', 'count', 'valueBytes', 'groupBytes']; extraResults = true; await expect(readTableValueOptions(context, input, stop)).rejects.toThrow();
    extraResults = false; rowValues = [['same', '1', '4'], ['same', '2', '4']]; await expect(readTableValueOptions(context, input, stop)).rejects.toThrow();
    expect(sent).not.toContain(controls[4]);
  });
  it('取消等待原stop及协议终态，不正常ROLLBACK也不自动重发SELECT', async () => {
    afterRow = () => { cancelled = true; }; await expect(readTableValueOptions(context, input, stop)).rejects.toThrow('取消');
    expect(stop).toHaveBeenCalledOnce(); expect(ended).toBe(true); expect(sent.filter(sql => sql.startsWith('SELECT CASE'))).toHaveLength(1); expect(sent).not.toContain(controls[4]);
  });
  it('聚合原ERR不重放，也不能以已拿到前几行声称成功', async () => {
    failure = Error('合成服务器原ERR'); await expect(readTableValueOptions(context, input, stop)).rejects.toThrow('原ERR'); expect(sent.filter(sql => sql.startsWith('SELECT CASE'))).toHaveLength(1); expect(sourceReads).toBe(1);
  });
  it.each(controls)('固定事务控制%s失败不发布或重试', async control => {
    const action = ports.query.getMockImplementation()!; ports.query.mockImplementation(async (...args: unknown[]) => { if (args[1] === control) { sent.push(control); throw Error('合成事务控制失败'); } return action(...args); });
    await expect(readTableValueOptions(context, input, stop)).rejects.toThrow('事务控制'); expect(sent.filter(sql => sql === control)).toHaveLength(1);
  });
});

describe('服务器身份不是缺字段默认值', () => {
  it('MySQL实际UUID和threadId绑定；Maria明确NULL UUID并保留原版本身份', async () => {
    expect(await readTableValueOptionsServerIdentity(context)).toMatch(/^[a-f0-9]{64}$/);
    context.managed.status = { version: '11.4.13-MariaDB-ubu2404', dialect: 'mariadb' }; expect(await readTableValueOptionsServerIdentity(context)).toMatch(/^[a-f0-9]{64}$/);
    expect(sent.at(-1)).toContain('NULL AS uuid');
    expect(sent.at(-1)).toContain('CAST((@@sql_quote_show_create+0) AS CHAR) AS quoteShowCreate');
    expect(sent.at(-1)).not.toContain('CAST(@@sql_quote_show_create AS CHAR)');
  });
  it.each(['10.11.19-MariaDB-ubu2204', '11.4.13-MariaDB-ubu2404'])('MariaDB %s原生布尔先数值化，前后保持严格数字1', async version => {
    context.managed.status = { version, dialect: 'mariadb' };
    const output = await readTableValueOptions(context, input, stop);
    expect(output.values).toHaveLength(3); expect(identityReads).toBe(2);
    const identities = sent.filter(sql => sql.startsWith('SELECT @@version AS version')); expect(identities).toHaveLength(2);
    expect(identities.every(sql => sql.includes('CAST((@@sql_quote_show_create+0) AS CHAR) AS quoteShowCreate'))).toBe(true);
  });
  it.each(['ON', 'OFF', 'true', '0'])('MariaDB未知/未数值化布尔回包%s仍拒绝，不以ON特例放宽身份门', async boolean => {
    context.managed.status = { version: '11.4.13-MariaDB-ubu2404', dialect: 'mariadb' }; identityReads = 1;
    identityPatch = value => ({ ...value, quoteShowCreate: boolean });
    await expect(readTableValueOptionsServerIdentity(context)).rejects.toThrow();
  });
  it.each(['version', 'hostname', 'port', 'serverId', 'currentUser', 'connectionId', 'lowerNames', 'sqlMode', 'charset', 'collation', 'quoteShowCreate', 'maxSortLength', 'sortBufferSize', 'uuid'])('缺失或无效身份%s不能当相等或按配置猜测', async field => {
    identityReads = 1; identityPatch = value => { const result = { ...value }; delete result[field]; return result; }; await expect(readTableValueOptionsServerIdentity(context)).rejects.toThrow();
  });
  it('不完整引用SHOW模式、非UTF8连接、错误thread和伪UUID明确失败', async () => {
    for (const patch of [{ quoteShowCreate: '0' }, { charset: 'latin1' }, { connectionId: '43' }, { uuid: 'unknown' }, { port: '3306.0' }, { maxSortLength: '1024' }, { sortBufferSize: '262144' }]) {
      identityReads = 1; identityPatch = value => ({ ...value, ...patch }); await expect(readTableValueOptionsServerIdentity(context)).rejects.toThrow();
    }
  });
});
