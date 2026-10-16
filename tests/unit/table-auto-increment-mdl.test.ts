import { describe, expect, it } from 'vitest';
import { tableAutoIncrementMdlProof, tableAutoIncrementMdlState, tableAutoIncrementMdlThread, tableAutoIncrementTaskUnfinished } from '../helpers/tableAutoIncrementMdl';

const sql = 'ALTER TABLE `dbark_auto_unit`.`cancelled` AUTO_INCREMENT = 50;', row = { Id: 42, State: tableAutoIncrementMdlState, Info: sql }, ids = new Set([1, 42, 44]);
const observe = (rows: Record<string, unknown>[], observerId: number | undefined = 1) => tableAutoIncrementMdlThread(rows, ids, observerId, sql);
describe('下一自增值取消前的独立MDL观察匹配', () => {
  it.each([42, '42'])('完整SQL、明确状态及本例线程%s全部相符才允许证明', id => { expect(observe([{ ...row, Id: id }])).toBe(42); });
  it('仅忽略末尾空白及分号，额外SQL、前缀或内部改写不匹配', () => {
    expect(observe([{ ...row, Info: sql.slice(0, -1) + ' \t' }])).toBe(42);
    for (const Info of [sql + ' SELECT 1', ' ' + sql, sql.replace(' = 50', ' = 51'), sql.replace('cancelled', 'other'), sql.replace(' = ', '='), null]) expect(observe([{ ...row, Info }])).toBeUndefined();
  });
  it.each([1, 43, 0, 42.5, '42x', '9007199254740993'])('拒绝observer、未记录或非精确线程%s', Id => { expect(observe([{ ...row, Id }])).toBeUndefined(); });
  it.each(['Waiting for metadata lock', 'Waiting for table metadata lock ', 'executing', null, undefined])('状态%s不能冒充明确table metadata lock等待', State => { expect(observe([{ ...row, State }])).toBeUndefined(); });
  it('零匹配、多条匹配及重复同线程行均不能宣称唯一等待', () => {
    for (const rows of [[], [row, { ...row, Id: 44 }], [row, { ...row }]]) expect(observe(rows)).toBeUndefined();
    expect(tableAutoIncrementMdlThread([row], ids, undefined, sql)).toBeUndefined();
  });
  it.each(['succeeded', 'failed', 'cancelled'])('本任务先%s时不能补记MDL，其他任务不误伤', status => {
    expect(tableAutoIncrementTaskUnfinished([{ taskId: '本例', status }], '本例')).toBe(false);
    expect(tableAutoIncrementTaskUnfinished([{ taskId: '其他', status }], '本例')).toBe(true);
  });
  it('即使仍报告running，DDL已完成也不能补记；仅发送后仍允许继续观察', () => {
    expect(tableAutoIncrementTaskUnfinished([{ taskId: '本例', status: 'running', tableAutoIncrement: { ddlCompleted: true } }], '本例')).toBe(false);
    expect(tableAutoIncrementTaskUnfinished([{ taskId: '本例', status: 'running', tableAutoIncrement: { ddlCompleted: false } }], '本例')).toBe(true);
  });
  it('诊断只含五个允许字段，失败不输出SQL或伪造等待状态', () => {
    expect(tableAutoIncrementMdlProof(13384, '本例任务', 42, true)).toEqual({ 端口: 13384, 任务ID: '本例任务', 本例线程ID: 42, 状态: tableAutoIncrementMdlState, 已观察: true });
    expect(tableAutoIncrementMdlProof(13484, '本例任务', undefined, false)).toEqual({ 端口: 13484, 任务ID: '本例任务', 本例线程ID: null, 状态: null, 已观察: false });
    expect(() => tableAutoIncrementMdlProof(3306, '本例任务', 42, true)).toThrow('白名单');
  });
});
