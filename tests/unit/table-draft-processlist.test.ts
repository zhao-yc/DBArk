import { describe, expect, it } from 'vitest';
import { assertTableDraftNoWarnings, assertTableDraftProcesslistVisible, assertTableDraftProcesslistWarnings, selectTableDraftProcesslist, tableDraftProcesslistDeprecation, tableDraftProcesslistNeedsCapability, tableDraftProcesslistQuery, type TableDraftProcesslistRequest } from '../helpers/tableDraftProcesslist';

const count = (value: unknown) => [{ '@@session.warning_count': value }];
const warning = () => ({ Level: 'Warning', Code: 1287, Message: tableDraftProcesslistDeprecation });
const pfs = () => selectTableDraftProcesslist('mysql', '8.4.11', [{ enabled: '1' }]);
const legacy = () => selectTableDraftProcesslist('mysql', '8.4.11', [{ enabled: '0' }]);

describe('草稿审计来源能力与原诊断模式', () => {
  it.each(['8.0.46', '8.4.11'])('MySQL%s必须依据准确P_S开关，不以空P_S回包决定降级', version => {
    expect(tableDraftProcesslistNeedsCapability('mysql', version)).toBe(true);
    for (const enabled of [1, '1']) expect(selectTableDraftProcesslist('mysql', version, [{ enabled }])).toEqual({ source: 'performance_schema.processlist', warningMode: 'zero' });
    for (const enabled of [0, '0']) expect(selectTableDraftProcesslist('mysql', version, [{ enabled }])).toEqual({ source: 'information_schema.PROCESSLIST', warningMode: 'mysql8-deprecated' });
    expect(() => selectTableDraftProcesslist('mysql', version, [])).toThrow();
  });
  it.each([['mysql', '5.7.44'], ['mariadb', '10.11.19-MariaDB-ubu2204'], ['mariadb', '5.5.5-11.4.13-MariaDB-ubu2404']] as const)('%s %s维持I_S零告警，不假定Maria开启P_S', (dialect, version) => {
    expect(tableDraftProcesslistNeedsCapability(dialect, version)).toBe(false);
    const selected = selectTableDraftProcesslist(dialect, version);
    expect(selected).toEqual({ source: 'information_schema.PROCESSLIST', warningMode: 'zero' });
    expect(() => assertTableDraftProcesslistWarnings(selected, count('1'), [warning()])).toThrow();
    expect(() => selectTableDraftProcesslist(dialect, version, [{ enabled: '0' }])).toThrow();
  });
  it.each([['mysql', '8.4.10'], ['mysql', '9.0.0'], ['mariadb', '10.11.18'], ['mysql', 'MariaDB'], ['mariadb', '8.4.11']] as const)('未知组合%s/%s不能取得审计来源', (dialect, version) => expect(() => selectTableDraftProcesslist(dialect, version, [{ enabled: 0 }])).toThrow());
  it.each([undefined, null, [], [{ enabled: '0' }, { enabled: '0' }], [{ enabled: false }], [{ enabled: '00' }], [{ enabled: 2 }], [{ enabled: '0', extra: true }], [Object.create({ enabled: '0' })]].map(value => ({ value })))('未知能力回包拒绝，不把未知当关闭：$value', ({ value }) => expect(() => selectTableDraftProcesslist('mysql', '8.4.11', value)).toThrow());
  it('能力与诊断访问器不执行，稀疏或夹带额外属性的行集合拒绝', () => {
    let calls = 0;
    const getter = Object.defineProperty({}, 'enabled', { enumerable: true, get() { calls++; return '0'; } });
    expect(() => selectTableDraftProcesslist('mysql', '8.4.11', [getter])).toThrow();
    expect(() => selectTableDraftProcesslist('mysql', '8.4.11', Object.assign([{ enabled: 0 }], { extra: true }))).toThrow();
    expect(() => selectTableDraftProcesslist('mysql', '8.4.11', new Array(1))).toThrow(); expect(calls).toBe(0);
  });
  it.each([0, '0'])('P_S/普通查询仅准确零计数与空诊断通过：%s', zero => {
    expect(() => assertTableDraftNoWarnings(count(zero), [])).not.toThrow();
    expect(() => assertTableDraftProcesslistWarnings(pfs(), count(zero), [])).not.toThrow();
  });
  it('已确认P_S关闭的专用读恰一条逐字1287通过，普通读与P_S读仍拒绝同一诊断', () => {
    for (const one of [1, '1']) expect(() => assertTableDraftProcesslistWarnings(legacy(), count(one), [warning()])).not.toThrow();
    expect(() => assertTableDraftNoWarnings(count('1'), [warning()])).toThrow();
    expect(() => assertTableDraftProcesslistWarnings(pfs(), count('1'), [warning()])).toThrow();
    expect(() => assertTableDraftProcesslistWarnings(legacy(), count('0'), [])).toThrow();
  });
  it.each([0, '0', 2, '2', '01', undefined, null, NaN, true])('非准确单告警计数拒绝：%s', value => expect(() => assertTableDraftProcesslistWarnings(legacy(), count(value), [warning()])).toThrow());
  it.each([[], [warning(), warning()], [{ ...warning(), Code: 1288 }], [{ ...warning(), Code: '1287' }], [{ ...warning(), Level: 'Note' }], [{ ...warning(), Level: 'warning' }], [{ ...warning(), Message: tableDraftProcesslistDeprecation + '.' }], [{ ...warning(), Message: 'PROCESSLIST deprecated' }], [{ ...warning(), extra: true }]].map(warnings => ({ warnings })))('未知/额外诊断或错误shape均拒绝：$warnings', ({ warnings }) => expect(() => assertTableDraftProcesslistWarnings(legacy(), count('1'), warnings)).toThrow());
  it('计数与诊断列表必须相互一致，额外告警不因第一条已知而被忽略', () => {
    expect(() => assertTableDraftProcesslistWarnings(legacy(), count('2'), [warning()])).toThrow();
    expect(() => assertTableDraftProcesslistWarnings(legacy(), count('1'), [warning(), { Level: 'Warning', Code: 9999, Message: '额外告警' }])).toThrow();
    expect(() => assertTableDraftProcesslistWarnings(legacy(), [{ '@@session.warning_count': '1', extra: 0 }], [warning()])).toThrow();
    const inherited = Object.create(warning()); expect(() => assertTableDraftProcesslistWarnings(legacy(), count('1'), [inherited])).toThrow();
    let calls = 0; const guarded = Object.defineProperty({ Level: 'Warning', Code: 1287 }, 'Message', { enumerable: true, get() { calls++; return tableDraftProcesslistDeprecation; } });
    expect(() => assertTableDraftProcesslistWarnings(legacy(), count('1'), [guarded])).toThrow(); expect(calls).toBe(0);
  });
  it('固定来源只生成ID集合、准确DB和采集条件，数据库名永远保留为参数', () => {
    expect(tableDraftProcesslistQuery(pfs(), { kind: 'ids', ids: [41, 42] })).toEqual({ sql: 'SELECT ID FROM performance_schema.processlist WHERE ID IN (?,?)', values: [41, 42] });
    expect(tableDraftProcesslistQuery(legacy(), { kind: 'database', database: 'db`name' })).toEqual({ sql: 'SELECT ID FROM information_schema.PROCESSLIST WHERE CAST(DB AS BINARY)=CAST(? AS BINARY)', values: ['db`name'] });
    expect(tableDraftProcesslistQuery(legacy(), { kind: 'collect', database: 'db_name', excludeId: 41 })).toEqual({ sql: 'SELECT ID FROM information_schema.PROCESSLIST WHERE ID<>? AND (CAST(DB AS BINARY)=CAST(? AS BINARY) OR INFO LIKE ?)', values: [41, 'db_name', '%db_name%'] });
    for (const input of [{ kind: 'ids', ids: [] }, { kind: 'ids', ids: [NaN] }, { kind: 'ids', ids: [0] }, { kind: 'database', database: '' }, { kind: 'database', database: 'db', sql: 'SELECT 1' }, { kind: 'query', database: 'db', excludeId: 1 }]) expect(() => tableDraftProcesslistQuery(legacy(), input as TableDraftProcesslistRequest)).toThrow();
  });
  it('self哨兵必须唯一且精确是原线程，空表/重复/别的线程不能追认无残留', () => {
    expect(() => assertTableDraftProcesslistVisible([{ ID: 41 }], 41)).not.toThrow(); expect(() => assertTableDraftProcesslistVisible([{ ID: '41' }], 41)).not.toThrow();
    for (const result of [[], [{ ID: 41 }, { ID: 41 }], [{ ID: 42 }], [{ ID: '041' }], [{ ID: 41, extra: 0 }], [Object.create({ ID: 41 })]]) expect(() => assertTableDraftProcesslistVisible(result, 41)).toThrow();
  });
});
