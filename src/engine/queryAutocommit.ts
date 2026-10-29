import { queryAutocommitApplySchema, checkQueryAutocommitOutput, queryAutocommitCleanup, queryAutocommitMayHaveChanged, type QueryAutocommitApplyInput, type QueryAutocommitOutput } from '../shared/queryAutocommit';
import { readQueryTransactionSettings, type QueryTransactionSettingsContext } from './queryTransactionSettings';

/** 在原会话互斥内比较完整快照，只发送一次固定SET；开启时允许已明确确认的隐式提交。 */
export async function applyQueryAutocommit(raw: QueryAutocommitApplyInput, context: QueryTransactionSettingsContext, onConfirmed?: (value: QueryAutocommitOutput) => void): Promise<QueryAutocommitOutput> {
  const input = queryAutocommitApplySchema.parse(raw); let sent = false, confirmed: QueryAutocommitOutput | undefined;
  try {
    const before = await readQueryTransactionSettings(context);
    for (const key of Object.keys(input.expected) as (keyof typeof before)[]) if (before[key] !== input.expected[key]) throw Error('自动提交的原会话快照已变化，请显式重新读取');
    if (before.autocommit === input.autocommit) return checkQueryAutocommitOutput({ confirmed: true, changed: false, implicitCommitAcknowledged: false, snapshot: before }, before, input.autocommit);
    context.check();
    /** 在取消连接收尾等待前消费原SET确认包，迟到取消和通知失败不能改写真实提交。 */
    const acknowledge = (result: { rows: unknown; fields: readonly { name: string }[] }) => {
      if (confirmed) return;
      const header = result.rows;
      if (!header || typeof header !== 'object' || Array.isArray(header) || result.fields !== undefined && (!Array.isArray(result.fields) || result.fields.length) || !('affectedRows' in header) || header.affectedRows !== 0 || !('warningStatus' in header) || header.warningStatus !== 0 || !('serverStatus' in header) || typeof header.serverStatus !== 'number' || !Number.isInteger(header.serverStatus) || header.serverStatus < 0 || header.serverStatus > 65535) throw Error('自动提交SET未获得完整无警告的单个确认包');
      if (String(context.physicalId()) !== before.serverConnectionId || context.status.dialect !== before.dialect || context.status.version !== before.serverVersion || Boolean(header.serverStatus & 2) !== input.autocommit || Boolean(header.serverStatus & 1) !== (input.autocommit ? false : before.transactionOpen)) throw Error('自动提交确认包的原物理会话或事务状态不一致');
      confirmed = checkQueryAutocommitOutput({ confirmed: true, changed: true, implicitCommitAcknowledged: input.autocommit && before.transactionOpen, snapshot: { ...before, autocommit: input.autocommit, transactionOpen: Boolean(header.serverStatus & 1) } }, before, input.autocommit);
      onConfirmed?.(confirmed);
    };
    const result = await context.query(`SET SESSION autocommit = ${input.autocommit ? 1 : 0}`, () => { sent = true; context.onSetSent?.(); }, acknowledge);
    if (!confirmed) acknowledge(result);
    return confirmed!;
  } catch (reason) {
    if (confirmed) return queryAutocommitCleanup(confirmed, reason);
    if (sent) throw queryAutocommitMayHaveChanged(reason);
    throw reason;
  }
}
