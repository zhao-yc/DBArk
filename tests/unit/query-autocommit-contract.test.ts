import { describe, expect, it } from 'vitest';
import { publicCommands } from '../../src/shared/commands';
import { validateCommand } from '../../src/shared/validation';
import { checkQueryAutocommitOutput, queryAutocommitApplySchema, queryAutocommitCleanup, queryAutocommitConfirmedMessage } from '../../src/shared/queryAutocommit';
import type { QueryTransactionSettingsSnapshot } from '../../src/shared/queryTransactionSettings';

const snapshot: QueryTransactionSettingsSnapshot = { dialect: 'mysql', serverVersion: '8.4.11', serverConnectionId: '9007199254740993', database: '原库', isolation: 'REPEATABLE READ', readOnly: false, transactionOpen: true, autocommit: false };
const input = { sessionId: '原会话', taskId: '独立任务', expected: snapshot, autocommit: true, allowImplicitCommit: true };
const output = { confirmed: true as const, changed: true, implicitCommitAcknowledged: true, snapshot: { ...snapshot, transactionOpen: false, autocommit: true } };

describe('自动提交输入与原会话确认合同', () => {
  it('公开命令单独列入preload白名单，保留精确连接编号及明确确认', () => {
    expect(publicCommands['query.autocommit.apply']).toBe(true);
    expect(queryAutocommitApplySchema.parse(input)).toEqual(input);
    expect(validateCommand('query.autocommit.apply', input)).toEqual(input);
    expect(() => validateCommand('query.autocommit.apply', { ...input, allowImplicitCommit: false })).toThrow();
    expect(checkQueryAutocommitOutput(output, snapshot, true)).toEqual(output);
  });
  it('只有关闭到开启且活动事务时才要求额外确认；同值或关闭不伪造提交', () => {
    expect(queryAutocommitApplySchema.safeParse({ ...input, allowImplicitCommit: false }).success).toBe(false);
    for (const expected of [{ ...snapshot, transactionOpen: false }, { ...snapshot, autocommit: true }]) expect(queryAutocommitApplySchema.safeParse({ ...input, expected, allowImplicitCommit: false }).success).toBe(true);
    expect(queryAutocommitApplySchema.safeParse({ ...input, autocommit: false, allowImplicitCommit: false }).success).toBe(true);
    const unchanged = checkQueryAutocommitOutput({ confirmed: true, changed: false, implicitCommitAcknowledged: false, snapshot }, snapshot, false);
    expect(queryAutocommitConfirmedMessage(unchanged)).toContain('未发送SET');
    expect(queryAutocommitConfirmedMessage(unchanged)).not.toContain('已确认提交');
  });
  it.each(['sql', 'scope', 'GLOBAL', 'connectionId', 'retry'])('拒绝多余字段%s', field => {
    expect(queryAutocommitApplySchema.safeParse({ ...input, [field]: '不允许' }).success).toBe(false);
  });
  it.each(['ON', 'OFF', 0, 1, null, undefined])('拒绝非布尔开关或确认 %j', value => {
    for (const field of ['autocommit', 'allowImplicitCommit']) expect(queryAutocommitApplySchema.safeParse({ ...input, [field]: value }).success).toBe(false);
  });
  it('不求值getter、不采信继承字段、缺失或额外符号', () => {
    let accessed = 0;
    const getter = { ...input }; Object.defineProperty(getter, 'autocommit', { enumerable: true, get() { accessed++; return true; } });
    expect(queryAutocommitApplySchema.safeParse(getter).success).toBe(false); expect(accessed).toBe(0);
    expect(queryAutocommitApplySchema.safeParse(Object.create(input)).success).toBe(false);
    expect(queryAutocommitApplySchema.safeParse({ ...input, [Symbol('额外')]: 1 }).success).toBe(false);
    const { expected: omitted, ...missing } = input; expect(omitted).toBe(snapshot);
    expect(queryAutocommitApplySchema.safeParse(missing).success).toBe(false);
  });
  it.each(['dialect', 'serverVersion', 'serverConnectionId', 'database', 'isolation', 'readOnly', 'transactionOpen', 'autocommit'])('回执必须完整匹配原身份或目标字段%s', field => {
    const alternatives: Record<string, unknown> = { dialect: 'mariadb', serverVersion: '8.4.10', serverConnectionId: '42', database: '另库', isolation: 'READ COMMITTED', readOnly: true, transactionOpen: true, autocommit: false };
    expect(() => checkQueryAutocommitOutput({ ...output, snapshot: { ...output.snapshot, [field]: alternatives[field] } }, snapshot, true)).toThrow();
  });
  it('changed和隐式提交确认不能缺失或虚报；收尾失败保留明确事实', () => {
    expect(() => checkQueryAutocommitOutput({ ...output, changed: false }, snapshot, true)).toThrow();
    expect(() => checkQueryAutocommitOutput({ ...output, implicitCommitAcknowledged: false }, snapshot, true)).toThrow();
    const retained = queryAutocommitCleanup(output, Error('晚通知失败'));
    expect(retained).toMatchObject(output); expect(retained.cleanupWarning).toContain('不会自动重试');
    expect(queryAutocommitConfirmedMessage(retained)).toContain('原活动事务已确认提交');
  });
});
