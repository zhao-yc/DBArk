import { describe, expect, it } from 'vitest';
import { publicCommands } from '../../src/shared/commands';
import { validateCommand } from '../../src/shared/validation';
import { assertQueryDatabaseSwitchOutput, queryDatabaseSwitchSchema, validateQueryDatabaseSwitchName, type QueryDatabaseSwitchInput, type QueryDatabaseSwitchOutput } from '../../src/shared/queryDatabaseSwitch';

const input: QueryDatabaseSwitchInput = { sessionId: '原会话', taskId: '切库任务', database: '业务`库', expectedContext: { state: 'known', database: '旧库' } };
const output: QueryDatabaseSwitchOutput = { sessionId: input.sessionId, taskId: input.taskId, database: input.database, completion: { database: input.database, databaseKnown: true, broken: false, busy: false }, transactionKnown: true, transactionOpen: true, unchanged: false };

describe('显式切库只接收固定原会话上下文', () => {
  it('公开命令接受known、null及unknown，保持名称大小写和反引号', () => {
    expect(publicCommands['query.databaseSwitch']).toBe(true);
    for (const expectedContext of [{ state: 'known', database: 'Case`库' }, { state: 'known', database: null }, { state: 'unknown' }] as const) {
      const request = { ...input, expectedContext };
      expect(validateCommand('query.databaseSwitch', request)).toEqual(request);
    }
    for (const database of ['information_schema', ' mysql', 'Case库', '库`名', '库'.repeat(64)]) expect(validateQueryDatabaseSwitchName(database)).toBe(database);
  });
  it.each(['', '库'.repeat(65), 'a\0b', 'a\nb', 'db.', 'a/b', 'a\\b', 'db ', 'db\u3000', '#mysql50#old', '\ud800', '\udfff', '库😀', undefined, null, 1, ['db']])('拒绝非受控库名（第 %# 项）', database => {
    expect(() => validateQueryDatabaseSwitchName(database)).toThrow();
    expect(queryDatabaseSwitchSchema.safeParse({ ...input, database }).success).toBe(false);
    expect(queryDatabaseSwitchSchema.safeParse({ ...input, expectedContext: { state: 'known', database } }).success).toBe(database === null);
  });
  it.each(['sql', 'profile', 'password', 'connectionId', 'fileToken', 'databaseContext'])('拒绝额外顶层字段%s', field => {
    expect(queryDatabaseSwitchSchema.safeParse({ ...input, [field]: '不允许' }).success).toBe(false);
  });
  it('缺失字段、数组与稀疏数组不能伪装成请求或上下文', () => {
    for (const key of Object.keys(input)) {
      const value: Record<string, unknown> = { ...input }; delete value[key];
      expect(queryDatabaseSwitchSchema.safeParse(value).success).toBe(false);
    }
    for (const value of [[], Array(4), Object.assign([], input)]) expect(queryDatabaseSwitchSchema.safeParse(value).success).toBe(false);
    for (const expectedContext of [[], Array(2), { state: 'unknown', database: 'db' }, { state: 'known' }, { state: 'unknown', sql: 'USE db' }, { state: 'other' }]) expect(queryDatabaseSwitchSchema.safeParse({ ...input, expectedContext }).success).toBe(false);
  });
  it('拒绝getter、继承、隐藏及符号字段，不执行不可信读取', () => {
    let calls = 0;
    const getter = () => { calls++; return 'known'; };
    for (const field of Object.keys(input)) {
      const value = { ...input }; Object.defineProperty(value, field, { enumerable: true, get: getter });
      expect(queryDatabaseSwitchSchema.safeParse(value).success).toBe(false);
    }
    for (const field of ['state', 'database']) {
      const expectedContext = { state: 'known', database: 'db' }; Object.defineProperty(expectedContext, field, { enumerable: true, get: getter });
      expect(queryDatabaseSwitchSchema.safeParse({ ...input, expectedContext }).success).toBe(false);
    }
    const hidden = { ...input }; Object.defineProperty(hidden, 'taskId', { value: input.taskId, enumerable: false });
    const extra = { ...input }; Object.defineProperty(extra, 'sql', { value: 'USE db' });
    for (const value of [hidden, extra, { ...input, [Symbol('sql')]: 'USE db' }, Object.create(input), Object.assign(Object.create({ inherited: true }), input)]) expect(queryDatabaseSwitchSchema.safeParse(value).success).toBe(false);
    expect(calls).toBe(0);
    expect(queryDatabaseSwitchSchema.safeParse(Object.assign(Object.create(null), input)).success).toBe(true);
  });
  it('任务及会话编号保留200字符边界，拒绝控制与孤立代理字符', () => {
    for (const field of ['sessionId', 'taskId']) for (const value of ['', undefined, 1, 'x'.repeat(201), 'a\0b', '\ud800']) expect(queryDatabaseSwitchSchema.safeParse({ ...input, [field]: value }).success).toBe(false);
    expect(queryDatabaseSwitchSchema.safeParse({ ...input, sessionId: 's'.repeat(200), taskId: 't'.repeat(200) }).success).toBe(true);
  });
});

describe('切库成功回执必须是原任务已确认事实', () => {
  it('接受明确事务状态和无transactionOpen的未知状态', () => {
    expect(() => assertQueryDatabaseSwitchOutput(output, input)).not.toThrow();
    const { transactionOpen: _open, ...unknown } = output;
    expect(() => assertQueryDatabaseSwitchOutput({ ...unknown, transactionKnown: false, unchanged: true }, input)).not.toThrow();
  });
  it.each([
    { sessionId: '其它会话' }, { taskId: '其它任务' }, { database: '其它库' }, { unchanged: undefined },
    { transactionKnown: false }, { transactionOpen: undefined }, { sql: 'USE db' },
    { completion: { ...output.completion, database: '其它库' } },
    { completion: { ...output.completion, databaseKnown: false } },
    { completion: { ...output.completion, busy: true } },
    { completion: { ...output.completion, broken: true } },
  ])('拒绝错误ACK，不将请求库名当作确认（第 %# 项）', changed => {
    expect(() => assertQueryDatabaseSwitchOutput({ ...output, ...changed }, input)).toThrow('待确认');
  });
  it('回包访问器及稀疏数组不被读取或接纳', () => {
    let calls = 0;
    const completion = { ...output.completion }; Object.defineProperty(completion, 'database', { enumerable: true, get() { calls++; return input.database; } });
    expect(() => assertQueryDatabaseSwitchOutput({ ...output, completion }, input)).toThrow();
    expect(() => assertQueryDatabaseSwitchOutput(Array(6), input)).toThrow();
    expect(calls).toBe(0);
  });
});
