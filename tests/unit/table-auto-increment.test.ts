import { describe, expect, it } from 'vitest';
import { compareAutoIncrementDecimal, validateTableAutoIncrement, tableAutoIncrementAcknowledgements } from '../../src/shared/tableAutoIncrement';
import { planTableAutoIncrement, readTableAutoIncrementDefinition, tableAutoIncrementMaximum } from '../../src/engine/tableAutoIncrementSql';
import { validateCommand } from '../../src/shared/validation';
import { assertTableAutoIncrementTargetAvailable } from '../../src/renderer/tableAutoIncrementServices';
import { tableAutoIncrementAcksComplete, tableAutoIncrementAckLabel, tableAutoIncrementFailure, TableAutoIncrementRequestFence, tableAutoIncrementResultMatches } from '../../src/renderer/tableAutoIncrementUi';
import type { TableAutoIncrementApplyOutput } from '../../src/shared/tableAutoIncrement';
import { assertTableAutoIncrementLiveTarget } from '../helpers/tableAutoIncrementTarget';

const mode = { dialect: 'mysql' as const, mode: { noBackslashEscapes: true, ansiQuotes: true } };
describe('下一自增值精确字符串与单一SQL边界', () => {
  it('回执不吻合、物理ID改变或成功字段矛盾不能投影成完整成功，关闭异常保留已完成事实', () => {
    const matched: TableAutoIncrementApplyOutput = { ddlSubmitted: true, ddlCompleted: true, requestedValue: '9007199254740993', definitionVerified: true, structureVerified: true, counterState: 'matched', warnings: [], after: { value: '9007199254740993', tableId: '9007199254740995', ddlHash: 'hash' } };
    expect(tableAutoIncrementResultMatches(matched, matched.requestedValue, matched.after?.tableId)).toBe(true);
    for (const result of [{ ...matched, requestedValue: '9007199254740994' }, { ...matched, structureVerified: false }, { ...matched, after: { ...matched.after!, value: '9007199254740994' } }, { ...matched, after: { ...matched.after!, tableId: 'another' } }]) expect(tableAutoIncrementResultMatches(result, matched.requestedValue, matched.after?.tableId)).toBe(false);
    expect(tableAutoIncrementResultMatches({ ...matched, definitionVerified: false, counterState: 'different', after: { ...matched.after!, value: '9007199254740994' } }, matched.requestedValue, matched.after?.tableId)).toBe(true);
    expect(tableAutoIncrementFailure({ phase: 'releasing', ddlSubmitted: true, ddlCompleted: true, definitionVerified: true, outcome: 'succeeded' }, true)).toBe('completedUnsettled');
  });
  it('核心/UI显式目标准备门限制200六实例，13484必须同一严格TLS/CA', () => {
    expect(() => assertTableAutoIncrementLiveTarget({ host: 'deve-server.yinzon.com', port: '13384' })).not.toThrow();
    expect(() => assertTableAutoIncrementLiveTarget({ host: '127.0.0.1', port: '13384' })).toThrow();
    expect(() => assertTableAutoIncrementLiveTarget({ host: 'deve-server.yinzon.com', port: '13484' })).toThrow('TLS');
    expect(() => assertTableAutoIncrementLiveTarget({ host: 'deve-server.yinzon.com', port: '13484', tlsFlag: '1', caPath: '准备门测试CA.pem' }, { host: 'deve-server.yinzon.com', port: '13484', tls: { enabled: true, rejectUnauthorized: false, caPath: '准备门测试CA.pem' } })).toThrow();
  });
  it.each([0, 1, 9007199254740992, '', '0', '01', '+1', '-1', '1.0', '1e9', '0x10', ' 10', '10 ', '10\n', '１８', '18446744073709551616'])('拒绝非规范或超上限值%j，不修剪、不经Number', value => expect(() => validateTableAutoIncrement(value)).toThrow());
  it('2^53相邻值与UINT64上限始终保真，计划只上调且固定单句', () => {
    expect(compareAutoIncrementDecimal('9007199254740992', '9007199254740993')).toBe(-1);
    expect(validateTableAutoIncrement('18446744073709551615')).toBe('18446744073709551615');
    expect(planTableAutoIncrement('db', 't', '9007199254740993', '9007199254740994', { name: 'id', type: 'bigint unsigned', maximum: '18446744073709551615' }).sql).toBe('ALTER TABLE `db`.`t` AUTO_INCREMENT = 9007199254740994;');
    for (const value of ['9007199254740992', '9007199254740993']) expect(() => planTableAutoIncrement('db', 't', '9007199254740993', value, { name: 'id', type: 'bigint', maximum: '9223372036854775807' })).toThrow('只允许上调');
  });
  it.each([['tinyint', '127'], ['tinyint unsigned', '255'], ['smallint', '32767'], ['smallint unsigned', '65535'], ['mediumint', '8388607'], ['mediumint unsigned', '16777215'], ['int', '2147483647'], ['int unsigned', '4294967295'], ['bigint(20)', '9223372036854775807'], ['BIGINT(20) UNSIGNED', '18446744073709551615']])('实际列类型%s的精确上限为%s', (type, maximum) => {
    expect(tableAutoIncrementMaximum(type)).toBe(maximum); expect(validateTableAutoIncrement(maximum, maximum)).toBe(maximum);
  });
  it.each(['decimal(20,0)', 'float', 'double', 'int unsigned zerofill', 'integer extra', 'bigint;DROP TABLE t'])('未知类型%s不猜测上限', type => expect(tableAutoIncrementMaximum(type)).toBeUndefined());
  it('只剔除顶层计数，列级AUTO_INCREMENT、文字量、索引和物理属性仍严格保留', () => {
    const before = "CREATE TABLE `t` (`id` bigint NOT NULL AUTO_INCREMENT,`s` varchar(40) COMMENT 'AUTO_INCREMENT=99',PRIMARY KEY (`id`)) ENGINE=InnoDB AUTO_INCREMENT=9007199254740993 DEFAULT CHARSET=utf8mb4 ROW_FORMAT=DYNAMIC COMMENT='原注释'";
    const read = readTableAutoIncrementDefinition(before, mode), changed = readTableAutoIncrementDefinition(before.replace('AUTO_INCREMENT=9007199254740993', 'AUTO_INCREMENT=9007199254740994'), mode);
    expect(read.value).toBe('9007199254740993'); expect(read.reasons).toEqual([]); expect(changed.preserved).toBe(read.preserved);
    for (const source of [before.replace('NOT NULL AUTO_INCREMENT', 'NOT NULL'), before.replace('ROW_FORMAT=DYNAMIC', 'ROW_FORMAT=COMPACT'), before.replace('原注释', '新注释'), before.replace('PRIMARY KEY', 'KEY'), before.replace('bigint', 'int')]) expect(readTableAutoIncrementDefinition(source, mode).preserved).not.toBe(read.preserved);
    expect(readTableAutoIncrementDefinition(before + ' AUTO_INCREMENT=3', mode).reasons.length).toBeGreaterThan(0);
  });
  it('IPC只收字符串和专属风险确认，不允许任意SQL或伪造连接修订', () => {
    expect(validateCommand('schema.tableAutoIncrement.preview', { snapshotId: 's', value: '9007199254740993', taskId: 'p' })).toMatchObject({ value: '9007199254740993' });
    for (const extra of [{ value: 9007199254740992 }, { sql: 'ALTER TABLE t ENGINE=MyISAM' }, { connectionRevision: 2 }]) expect(() => validateCommand('schema.tableAutoIncrement.preview', { snapshotId: 's', value: '9', taskId: 'p', ...extra })).toThrow();
    expect(tableAutoIncrementAcksComplete(tableAutoIncrementAcknowledgements, new Set(tableAutoIncrementAcknowledgements))).toBe(true);
    expect(tableAutoIncrementAcksComplete(tableAutoIncrementAcknowledgements.slice(0, 2), new Set(tableAutoIncrementAcknowledgements))).toBe(false); expect(tableAutoIncrementAckLabel('__proto__')).toBeUndefined();
  });
  it('同目标隐藏数据/布局草稿及任务阻断入口，其他目标不误拦截；取消不提前释放busy', () => {
    const target = { connectionId: 'c', database: 'db', table: 't' }, workspace = { settings: { tabs: [{ id: 'hidden', kind: 'table' as const, title: 't', ...target }] }, dirtyTabs: {}, activeJobs: {} };
    expect(() => assertTableAutoIncrementTargetAvailable(target, { ...workspace, dirtyTabs: { hidden: true } })).toThrow('草稿');
    expect(() => assertTableAutoIncrementTargetAvailable(target, { ...workspace, tableLayoutDrafts: { hidden: true } })).toThrow('草稿');
    expect(() => assertTableAutoIncrementTargetAvailable(target, { ...workspace, activeJobs: { hidden: true } })).toThrow('活动任务');
    expect(() => assertTableAutoIncrementTargetAvailable({ ...target, table: 'T' }, { ...workspace, dirtyTabs: { hidden: true } })).not.toThrow();
    const fence = new TableAutoIncrementRequestFence(), old = fence.begin('one')!; expect(fence.begin('two')).toBeUndefined(); fence.cancel(); expect(fence.busy).toBe(true); expect(fence.accepts(old)).toBe(false); fence.finish(old); fence.dispose(); expect(fence.begin('late')).toBeUndefined();
    expect(tableAutoIncrementFailure(null, true)).toBe('unknown'); expect(tableAutoIncrementFailure({ phase: 'releasing', ddlSubmitted: true, ddlCompleted: true, definitionVerified: false, outcome: 'succeeded' }, true)).toBe('verificationFailed');
  });
});
