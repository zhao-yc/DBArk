import { postgresCheckPlan, type PostgresCheckPreviewInput } from '../../shared/postgresCheckEdit';
import type { PostgresConnection } from './connection';
import type { readPostgresStructureFacts } from './relationStructure';

type Facts = Awaited<ReturnType<typeof readPostgresStructureFacts>>;
const budget = () => ({ rows: 1, bytes: 8192 });

/** 预览只发送 Parse，提交用扩展协议，核对既有约束身份和新约束的目录状态。 */
export async function preparePostgresCheckEdit({ output, checkIds }: Facts, input: PostgresCheckPreviewInput,
  connection: PostgresConnection) {
  const { connectionId, database, table, editStamp, changes } = input;
  const plan = postgresCheckPlan(output, { connectionId, database, table, editStamp, changes });
  if (!connection.standardStrings) throw Error('CHECK 表达式字符串模式未确认');
  for (const sql of plan.statements) await connection.query(sql, undefined, budget(), undefined, 'parse');
  const originals = new Set(checkIds.values());
  return {
    table: plan.table, statements: plan.statements, protocol: 'extended' as const,
    /** 服务器反编译的表达式和状态回读自同一写入事务。 */
    verify(final: Facts) {
      const actual = final.output.constraints.filter(constraint => constraint.kind === 'c' && !constraint.inherited);
      return actual.length === plan.checks.size && actual.every(constraint => {
        const expected = plan.checks.get(constraint.name), oid = final.checkIds.get(constraint.name);
        const current = constraint.check;
        if (!expected || !oid || !current || constraint.validated !== expected.validated || (current.comment ?? null) !== expected.comment) return false;
        if (expected.original) {
          const old = expected.original.check;
          return oid === checkIds.get(expected.original.name) && old?.expression === current.expression &&
            old.noInherit === current.noInherit && old.enforced === current.enforced;
        }
        return !originals.has(oid) && current.enforced === !expected.created?.notEnforced && current.noInherit === expected.created?.noInherit;
      });
    },
  };
}
