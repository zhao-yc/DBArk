import { describe, expect, it } from 'vitest';
import {
  parseQueryTransactionBoolean, parseQueryTransactionIsolation, queryTransactionIsolations,
  queryTransactionSettingsApplySchema, queryTransactionSettingsReadSchema, queryTransactionSettingsSnapshotSchema,
  queryTransactionSettingsSql, queryTransactionSettingsVariables,
  type QueryTransactionIsolation, type QueryTransactionSettingsSnapshot,
} from '../../src/shared/queryTransactionSettings';

const modern = { isolation: 'transaction_isolation', readOnly: 'transaction_read_only' };
const legacy = { isolation: 'tx_isolation', readOnly: 'tx_read_only' };
const snapshot: QueryTransactionSettingsSnapshot = {
  dialect: 'mysql', serverVersion: '8.4.11', serverConnectionId: '9007199254740993', database: '业务库',
  isolation: 'REPEATABLE READ', readOnly: false, transactionOpen: false, autocommit: true,
};
const readInput = { sessionId: '当前查询标签会话', taskId: '读取任务' };
const applyInput = { ...readInput, expected: snapshot, isolation: 'READ COMMITTED', readOnly: true };

describe('事务变量选择使用明确的官方版本边界', () => {
  it.each(['5.7.20', '5.7.44-log', '8.0.3', '8.0.46-0ubuntu0.22.04.1', '8.4.0', '8.4.11'])('MySQL %s只选择现代会话变量', version => {
    expect(queryTransactionSettingsVariables({ dialect: 'mysql', version })).toEqual(modern);
  });
  it.each(['10.11.0', '10.11.19-MariaDB', '5.5.5-10.11.19-MariaDB-ubu2204'])('MariaDB %s保留10.11旧变量', version => {
    expect(queryTransactionSettingsVariables({ dialect: 'mariadb', version })).toEqual(legacy);
  });
  it.each(['11.1.1-MariaDB', '11.4.13-MariaDB', '5.5.5-11.4.13-MariaDB', '11.8.0'])('MariaDB %s使用11.1.1起的现代变量', version => {
    expect(queryTransactionSettingsVariables({ dialect: 'mariadb', version })).toEqual(modern);
  });
  it.each(['5.7.19', '5.6.51', '8.0.0', '8.0.2', '8.1.0', '9.0.0', '10.11.19-MariaDB', '5.5.5-8.4.11', '8.0', '08.4.11', '8.4.11x', '8.4.11\n', '', '未知', '8.4.11-' + 'a'.repeat(256)])('MySQL %s不猜别名或降级变量', version => {
    expect(() => queryTransactionSettingsVariables({ dialect: 'mysql', version })).toThrow();
  });
  it.each(['10.10.10', '11.0.6', '11.1.0', '12.0.0', '8.4.11', '5.5.5', '5.5.5-11.1.0-MariaDB', '11.4', '11.4.13\0', '未知'])('MariaDB %s拒绝未覆盖或不明确版本', version => {
    expect(() => queryTransactionSettingsVariables({ dialect: 'mariadb', version })).toThrow();
  });
  it('拒绝未知方言或非字符串版本，不因运行时类型绕过而选变量', () => {
    expect(() => queryTransactionSettingsVariables({ dialect: 'other', version: '8.4.11' } as never)).toThrow();
    expect(() => queryTransactionSettingsVariables({ dialect: 'mysql', version: 80411 } as never)).toThrow();
    expect(() => queryTransactionSettingsVariables(null as never)).toThrow();
  });
});

describe('服务器事务值严格解析', () => {
  it.each([
    ['READ-UNCOMMITTED', 'READ UNCOMMITTED'], ['READ UNCOMMITTED', 'READ UNCOMMITTED'],
    ['READ-COMMITTED', 'READ COMMITTED'], ['READ COMMITTED', 'READ COMMITTED'],
    ['REPEATABLE-READ', 'REPEATABLE READ'], ['REPEATABLE READ', 'REPEATABLE READ'], ['SERIALIZABLE', 'SERIALIZABLE'],
  ])('隔离级别%s明确转换为空格枚举', (input, expected) => {
    expect(parseQueryTransactionIsolation(input)).toBe(expected);
  });
  it.each(['read-committed', 'READ_COMMITTED', ' READ COMMITTED', 'READ COMMITTED ', 'READ  COMMITTED', 'SNAPSHOT', '', 'READ COMMITTED; COMMIT', null, undefined, 1, {}, ['SERIALIZABLE']])('拒绝未知隔离级别%j', input => {
    expect(() => parseQueryTransactionIsolation(input)).toThrow();
  });
  it.each([false, 0, '0', 'OFF'])('明确假值%j不误判为true', input => {
    expect(parseQueryTransactionBoolean(input)).toBe(false);
  });
  it.each([true, 1, '1', 'ON'])('明确真值%j保持true', input => {
    expect(parseQueryTransactionBoolean(input)).toBe(true);
  });
  it.each(['false', 'true', 'off', 'on', ' OFF', 'ON ', '00', '01', '', '2', 2, -1, Number.NaN, Infinity, null, undefined, {}, [], 1n])('拒绝宽松布尔值（第 %# 项）', input => {
    expect(() => parseQueryTransactionBoolean(input)).toThrow();
  });
  it('不调用未知值的字符串化钩子', () => {
    let calls = 0;
    const input = { toString() { calls++; return 'ON'; }, valueOf() { calls++; return 1; } };
    expect(() => parseQueryTransactionIsolation(input)).toThrow();
    expect(() => parseQueryTransactionBoolean(input)).toThrow();
    expect(calls).toBe(0);
  });
});

describe('本会话固定SET语句不携带可注入范围', () => {
  it('所有隔离级别和访问模式都只生成一条SESSION默认设置语句', () => {
    expect(queryTransactionIsolations).toEqual(['READ UNCOMMITTED', 'READ COMMITTED', 'REPEATABLE READ', 'SERIALIZABLE']);
    for (const isolation of queryTransactionIsolations) for (const readOnly of [false, true]) {
      expect(queryTransactionSettingsSql(isolation, readOnly)).toBe(`SET SESSION TRANSACTION ISOLATION LEVEL ${isolation}, READ ${readOnly ? 'ONLY' : 'WRITE'}`);
    }
  });
  it.each(['READ-COMMITTED', 'GLOBAL', 'READ COMMITTED; COMMIT', 'SERIALIZABLE, READ WRITE; DROP DATABASE x', undefined, {}, ['SERIALIZABLE']])('运行时也拒绝未列入枚举的SQL片段%j', input => {
    expect(() => queryTransactionSettingsSql(input as QueryTransactionIsolation, false)).toThrow();
  });
  it.each(['OFF', 'ON', '0', '1', 0, 1, null, undefined])('不将非boolean访问模式%j代入SQL', input => {
    expect(() => queryTransactionSettingsSql('SERIALIZABLE', input as unknown as boolean)).toThrow();
  });
});

describe('事务读取和应用输入严格绑定完整快照', () => {
  it('接受读取、应用及无默认数据库的完整快照，并保持大连接编号原文', () => {
    expect(queryTransactionSettingsReadSchema.parse(readInput)).toEqual(readInput);
    const parsed = queryTransactionSettingsApplySchema.parse(applyInput);
    expect(parsed).toEqual(applyInput); expect(parsed.expected).not.toBe(snapshot);
    expect(parsed.expected.serverConnectionId).toBe('9007199254740993');
    expect(queryTransactionSettingsSnapshotSchema.parse({ ...snapshot, database: null, serverConnectionId: '18446744073709551615', transactionOpen: true, autocommit: false })).toMatchObject({ database: null, transactionOpen: true, autocommit: false });
    expect(queryTransactionSettingsSnapshotSchema.parse({ ...snapshot, dialect: 'mariadb', serverVersion: '5.5.5-10.11.19-MariaDB' }).dialect).toBe('mariadb');
  });
  it.each(['sql', 'GLOBAL', 'scope', 'action', 'autocommit', 'connectionId', 'transactionOpen'])('读取或应用顶层拒绝未知字段%s', field => {
    expect(queryTransactionSettingsReadSchema.safeParse({ ...readInput, [field]: '不允许' }).success).toBe(false);
    expect(queryTransactionSettingsApplySchema.safeParse({ ...applyInput, [field]: '不允许' }).success).toBe(false);
  });
  it('完整expected的任一身份或状态字段缺失均拒绝', () => {
    for (const key of Object.keys(snapshot)) {
      const incomplete: Record<string, unknown> = { ...snapshot }; delete incomplete[key];
      expect(queryTransactionSettingsApplySchema.safeParse({ ...applyInput, expected: incomplete }).success).toBe(false);
    }
    for (const key of Object.keys(applyInput)) {
      const incomplete: Record<string, unknown> = { ...applyInput }; delete incomplete[key];
      expect(queryTransactionSettingsApplySchema.safeParse(incomplete).success).toBe(false);
    }
  });
  it.each(['', '0', '00', '01', '+1', '-1', '1.0', '1e2', ' 1', '18446744073709551616', '9'.repeat(21), 1, 9007199254740993n])('物理连接编号不能非规范化或丢精度（第 %# 项）', serverConnectionId => {
    expect(queryTransactionSettingsSnapshotSchema.safeParse({ ...snapshot, serverConnectionId }).success).toBe(false);
  });
  it.each([
    { database: '' }, { database: '库'.repeat(65) }, { database: 'a\0b' }, { database: undefined },
    { serverVersion: '' }, { serverVersion: '9.0.0' }, { dialect: 'postgres' }, { isolation: 'READ-COMMITTED' },
    { readOnly: 'OFF' }, { transactionOpen: 0 }, { autocommit: '1' }, { sql: 'SELECT 1' }, { GLOBAL: true },
  ])('回包快照拒绝未知字段或非规范值%j', changed => {
    expect(queryTransactionSettingsSnapshotSchema.safeParse({ ...snapshot, ...changed }).success).toBe(false);
  });
  it('读写编号沿用既有200字符边界，不能省略、空或传数值', () => {
    for (const field of ['sessionId', 'taskId']) for (const value of ['', undefined, 1, 'a'.repeat(201)]) {
      expect(queryTransactionSettingsReadSchema.safeParse({ ...readInput, [field]: value }).success).toBe(false);
      expect(queryTransactionSettingsApplySchema.safeParse({ ...applyInput, [field]: value }).success).toBe(false);
    }
    expect(queryTransactionSettingsReadSchema.safeParse({ sessionId: 'a'.repeat(200), taskId: 'b'.repeat(200) }).success).toBe(true);
  });
  it('应用只接受空格枚举和真正boolean，不做服务器读取时的转换', () => {
    expect(queryTransactionSettingsApplySchema.safeParse({ ...applyInput, isolation: 'READ-COMMITTED' }).success).toBe(false);
    expect(queryTransactionSettingsApplySchema.safeParse({ ...applyInput, readOnly: 'ON' }).success).toBe(false);
  });
  it('拒绝访问器、隐藏字段、符号字段和继承身份且不调用getter', () => {
    let calls = 0;
    const accessor = { ...snapshot };
    Object.defineProperty(accessor, 'serverConnectionId', { enumerable: true, get() { calls++; return '1'; } });
    expect(queryTransactionSettingsApplySchema.safeParse({ ...applyInput, expected: accessor }).success).toBe(false);
    const outerAccessor = { ...applyInput };
    Object.defineProperty(outerAccessor, 'expected', { enumerable: true, get() { calls++; return snapshot; } });
    expect(queryTransactionSettingsApplySchema.safeParse(outerAccessor).success).toBe(false);
    expect(calls).toBe(0);
    expect(queryTransactionSettingsReadSchema.safeParse(Object.create(readInput)).success).toBe(false);
    expect(queryTransactionSettingsSnapshotSchema.safeParse(Object.assign(Object.create({ sql: 'SQL' }), snapshot)).success).toBe(false);
    expect(queryTransactionSettingsReadSchema.safeParse({ ...readInput, [Symbol('sql')]: 'SQL' }).success).toBe(false);
    const hidden = { ...readInput }; Object.defineProperty(hidden, 'sql', { value: 'SQL' });
    expect(queryTransactionSettingsReadSchema.safeParse(hidden).success).toBe(false);
    const hiddenRequired = { ...readInput }; Object.defineProperty(hiddenRequired, 'taskId', { enumerable: false, value: '任务' });
    expect(queryTransactionSettingsReadSchema.safeParse(hiddenRequired).success).toBe(false);
    expect(queryTransactionSettingsSnapshotSchema.safeParse([]).success).toBe(false);
    expect(queryTransactionSettingsReadSchema.safeParse(Object.assign(Object.create(null), readInput)).success).toBe(true);
  });
});
