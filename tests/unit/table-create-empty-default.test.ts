import { describe, expect, it, vi } from 'vitest';
import { buildDesign } from '../../src/engine/sql';
import { assertEmptyDefaultColumns, assertEmptyDefaultDdl, assertEmptyDefaultFacts, bindEmptyDefaultTarget, closeEmptyDefaultStream, emptyDefaultGuard, emptyDefaultKeys, finishEmptyDefaultCase } from '../helpers/tableCreateEmptyDefault';

const uuid = '11111111-2222-4333-8444-555555555555';
/** 认证全部为合成RAM值，不读取环境、磁盘私料或驱动。 */
function configuration() {
  const raw: Record<string, string | undefined> = { DBARK_TEST_HOST: '192.168.31.200', DBARK_TEST_PORT: '13384', DBARK_TEST_TLS: '0', DBARK_TEST_USER: 'synthetic', DBARK_TEST_PASSWORD: '', DBARK_TEST_EXPECTED_SERVER_UUID: uuid, DBARK_EXECUTABLE_PATH: 'X:/synthetic/DBArk.exe', DBARK_INTEGRATION_ENABLED: '1', DBARK_TABLE_CREATE_EMPTY_DEFAULT_UI: '1' };
  return { raw, helper: { ...raw } };
}
const facts = () => [{ version: '8.4.11', os: 'Linux', names: 0, uuid, mode: 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION', autocommit: 1, innodbStrict: 1, quoteShowCreate: 1, gipk: 0 }];
/** 直接执行正式live使用的停链与收尾函数；退出和DROP只提供可计数的RAM端口。 */
function harness() {
  const state = { now: 0, closed: false, owns: true }, retain = vi.fn(), guard = emptyDefaultGuard({ now: () => state.now, retain, assertCurrent(allowClosed) { if (!state.owns || !allowClosed && state.closed) throw Error('合成窗口归属未知'); } }, 100);
  const ports = { tasks: vi.fn(async (): Promise<unknown> => [{ kind: 'schema.tableCreate.apply', status: 'completed' }]), exit: vi.fn(async () => { state.closed = true; }), assertClosed: () => { if (!state.closed) throw Error('合成应用未关闭'); }, verifyOwned: vi.fn(async () => {}), drop: vi.fn(async () => {}), absent: vi.fn(async () => {}), close: vi.fn(async () => {}) };
  return { state, retain, guard, ports };
}
describe('空串正式UI的显式目标与独立目录断言', () => {
  it('允许显式空密码；缺失、继承属性、不一致或开发入口均在连接前拒绝', () => {
    const valid = configuration(); expect(bindEmptyDefaultTarget(() => valid.raw, valid.helper).target.password).toBe('');
    for (const key of emptyDefaultKeys) { const { raw, helper } = configuration(); delete raw[key]; expect(() => bindEmptyDefaultTarget(() => raw, helper)).toThrow('显式一致'); }
    const inherited = configuration(); expect(() => bindEmptyDefaultTarget(() => Object.create(inherited.raw), inherited.helper)).toThrow('显式一致');
    const mismatch = configuration(); mismatch.helper.DBARK_TEST_PASSWORD = '合成错值'; expect(() => bindEmptyDefaultTarget(() => mismatch.raw, mismatch.helper)).toThrow('显式一致');
    const dev = configuration(); dev.raw.DBARK_DEV_URL = 'http://invalid.example'; expect(() => bindEmptyDefaultTarget(() => dev.raw, dev.helper)).toThrow('目标未准备');
  });
  it('raw或helper变化被观测后恢复原值也不能重绑定', () => {
    for (const side of ['raw', 'helper'] as const) { const f = configuration(), binding = bindEmptyDefaultTarget(() => f.raw, f.helper); f[side].DBARK_TEST_EXPECTED_SERVER_UUID = '合成变化'; expect(() => binding.assertCurrent()).toThrow(); f[side].DBARK_TEST_EXPECTED_SERVER_UUID = uuid; expect(() => binding.assertCurrent()).toThrow('已变化'); }
  });
  it('准确版本、UUID与普通模式/能力必须齐全，不能用8.4大版本或GIPK兜底', () => {
    expect(assertEmptyDefaultFacts(facts(), uuid)).toContain('8.4.11');
    for (const patch of [{ version: '8.4.12' }, { version: '8.4.11-MariaDB' }, { uuid: '错实例' }, { mode: 'ANSI_QUOTES' }, { mode: undefined }, { gipk: 1 }, { innodbStrict: 0 }, { names: 1 }]) expect(() => assertEmptyDefaultFacts([{ ...facts()[0], ...patch }], uuid)).toThrow();
  });
  it('独立COLUMNS严格区分空串、文字NULL、SQL NULL及未设，缺列/额外列也拒绝', () => {
    const rows = [['id', 'int', 'NO', null], ['empty_text', 'varchar(64)', 'NO', ''], ['literal_null', 'varchar(64)', 'YES', 'NULL'], ['sql_null', 'varchar(64)', 'YES', null], ['note', 'varchar(64)', 'YES', '普通默认'], ['unset_text', 'varchar(64)', 'NO', null]].map(([COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT]) => ({ COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA: '', GENERATION_EXPRESSION: '' }));
    expect(() => assertEmptyDefaultColumns(rows)).not.toThrow();
    for (const [index, value] of [[1, null], [2, null], [3, 'NULL'], [5, '']] as const) { const changed = structuredClone(rows); changed[index].COLUMN_DEFAULT = value; expect(() => assertEmptyDefaultColumns(changed)).toThrow('定义不符'); }
    expect(() => assertEmptyDefaultColumns(rows.slice(1))).toThrow(); expect(() => assertEmptyDefaultColumns([...rows, rows[0]])).toThrow();
  });
  it('真实预览/SHOW用同一独立语义断言，未设列出现DEFAULT或空串被省略均报错', () => {
    const sql = "CREATE TABLE `db`.`t` (`id` int NOT NULL, `empty_text` varchar(64) NOT NULL DEFAULT '', `literal_null` varchar(64) DEFAULT 'NULL', `sql_null` varchar(64) DEFAULT NULL, `note` varchar(64) DEFAULT '普通默认', `unset_text` varchar(64) NOT NULL, PRIMARY KEY (`id`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;";
    expect(() => assertEmptyDefaultDdl(sql, true)).not.toThrow();
    const unset = sql.replace("`empty_text` varchar(64) NOT NULL DEFAULT ''", '`empty_text` varchar(64) NOT NULL');
    expect(() => assertEmptyDefaultDdl(unset, false)).not.toThrow(); expect(() => assertEmptyDefaultDdl(unset, true)).toThrow();
    expect(() => assertEmptyDefaultDdl(sql.replace('`unset_text` varchar(64) NOT NULL', "`unset_text` varchar(64) NOT NULL DEFAULT ''"), true)).toThrow();
  });
  it('本场景草稿经实际生成器产生的SQL通过独立断言，取消后只允许未设语义', () => {
    const design = { database: 'db', name: 't', engine: 'InnoDB', charset: 'utf8mb4', comment: '', indexes: [{ name: 'PRIMARY', unique: true, columns: ['id'] }], foreignKeys: [], columns: [
      { name: 'id', type: 'int', nullable: false }, { name: 'empty_text', type: 'varchar(64)', nullable: false, defaultValue: '' },
      { name: 'literal_null', type: 'varchar(64)', nullable: true, defaultValue: 'NULL' }, { name: 'sql_null', type: 'varchar(64)', nullable: true, defaultValue: null },
      { name: 'note', type: 'varchar(64)', nullable: true, defaultValue: '普通默认' }, { name: 'unset_text', type: 'varchar(64)', nullable: false },
    ].map(column => ({ ...column, autoIncrement: false, comment: '' })) };
    expect(() => assertEmptyDefaultDdl(buildDesign(design).sql, true)).not.toThrow();
    delete design.columns[1].defaultValue; expect(() => assertEmptyDefaultDdl(buildDesign(design).sql, false)).not.toThrow();
  });
});

describe('空串正式UI的原时限、sticky归属和严格关闭', () => {
  it('通知失败不覆盖首因，本地sticky先写，后续退出/DROP均0', async () => {
    const f = harness(), original = Error('合成CREATE结果未知'); f.retain.mockImplementation(() => { expect(f.guard.state.retained).toBe(true); throw Error('合成通知失败'); });
    await expect(f.guard.run(async () => { throw original; })).rejects.toBe(original);
    await expect(finishEmptyDefaultCase(f.guard, f.ports)).rejects.toThrow('停链'); expect(f.ports.tasks).not.toHaveBeenCalled(); expect(f.ports.exit).not.toHaveBeenCalled(); expect(f.ports.drop).not.toHaveBeenCalled(); expect(f.retain).toHaveBeenCalledTimes(1);
  });
  it('afterEach先看到活动主体就停链；迟到ACK无法继续读取、退出或清理', async () => {
    const f = harness(); let finish!: () => void;
    const waiting = f.guard.run(() => new Promise<void>(resolve => { finish = resolve; })).catch(reason => reason);
    expect(f.guard.state.pending).toBe(1); expect(() => f.guard.afterEach()).toThrow('尚未确认'); finish(); expect(await waiting).toBeInstanceOf(Error);
    await expect(finishEmptyDefaultCase(f.guard, f.ports)).rejects.toThrow(); expect(f.ports.exit).not.toHaveBeenCalled(); expect(f.ports.drop).not.toHaveBeenCalled();
  });
  it('即使afterEach尚未运行，原45秒期限后返回的观察也不能继续', async () => {
    const f = harness(), next = vi.fn(async () => {});
    await expect(f.guard.run(async () => { f.state.now = 100; })).rejects.toThrow('原时限');
    await expect(f.guard.run(next)).rejects.toThrow(); expect(next).not.toHaveBeenCalled();
  });
  it('正常链只退出/精确复核/DROP/验证不存在/strict close各一次，完成后活动门关闭', async () => {
    const f = harness(); await finishEmptyDefaultCase(f.guard, f.ports); f.guard.afterEach();
    for (const port of [f.ports.exit, f.ports.verifyOwned, f.ports.drop, f.ports.absent, f.ports.close]) expect(port).toHaveBeenCalledTimes(1);
    expect(f.guard.state).toEqual({ retained: false, active: false, pending: 0 });
  });
  it.each(['running', 'failed', 'cancelled', 'unknown'])('CREATE为%s时绝不通过退出或DROP消除未知', async status => {
    const f = harness(); f.ports.tasks.mockResolvedValue([{ kind: 'schema.tableCreate.apply', status }]); await expect(finishEmptyDefaultCase(f.guard, f.ports)).rejects.toThrow('终态未知'); expect(f.ports.exit).not.toHaveBeenCalled(); expect(f.ports.drop).not.toHaveBeenCalled();
  });
  it('owner变化或退出后准确资源复核失败均保留，不能DROP', async () => {
    const f = harness(); f.ports.verifyOwned.mockRejectedValue(Error('合成同名表已变化')); await expect(finishEmptyDefaultCase(f.guard, f.ports)).rejects.toThrow('同名表'); expect(f.ports.drop).not.toHaveBeenCalled();
    const other = harness(); other.state.owns = false; await expect(finishEmptyDefaultCase(other.guard, other.ports)).rejects.toThrow('归属'); expect(other.ports.tasks).not.toHaveBeenCalled();
  });
  it('strict close必须同一原生流真实closed，缺流/替换流/仅end均拒绝', async () => {
    const stream = () => ({ closed: false, once() {}, removeListener() {}, end() {}, destroy() {} });
    const native = () => ({ stream: stream(), end() {}, destroy() {} });
    const good = native(); await closeEmptyDefaultStream(good, async value => { value.stream.closed = true; });
    await expect(closeEmptyDefaultStream(undefined, vi.fn())).rejects.toThrow('原生连接');
    await expect(closeEmptyDefaultStream(native(), async () => {})).rejects.toThrow('close未确认');
    await expect(closeEmptyDefaultStream(native(), async value => { value.stream = { ...stream(), closed: true }; })).rejects.toThrow('同一底层流');
  });
});
