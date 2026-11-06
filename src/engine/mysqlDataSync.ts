import type { CellValue, DataRow, RowChange, TableInfo } from '../shared/contracts';
import type { PostgresDataCompareEndpoint as Target } from '../shared/postgresDataCompare';
import type { PostgresTableOutcome } from '../shared/postgresTable';
import { applyTableTransaction, emptyTableApplyEvidence } from './tableApplyTransaction';
import { command, header, readTarget } from './tableFilteredUpdateProtocol';
import { configureTableFilteredDeleteForeignKeys, readTableFilteredDeleteTarget } from './tableFilteredDeleteProtocol';
import { identifier, qualified, deserializeCell, typedCellPlaceholder } from './sql';
import type { StructureTaskContext } from './structureDefinition';
import { validateLosslessImport } from './losslessImport';

export type MysqlSyncTarget = Awaited<ReturnType<typeof readTarget>>;
export interface MysqlSyncRow { before?: CellValue[]; after?: CellValue[]; }
export interface MysqlSyncEvidence { metadata: MysqlSyncTarget; columns: string[]; rows: MysqlSyncRow[]; }
export type MysqlPageParameters = (string | number | boolean | null | Buffer)[];
export type MysqlSyncContext = StructureTaskContext & {
  page(sql: string, params: MysqlPageParameters): Promise<{ rows: DataRow[]; columns: { name: string }[]; hasMore: boolean }>;
};
export const readMysqlSyncTarget = readTarget;

const types = /^(?:tinyint|smallint|mediumint|int|bigint|decimal|float|double|real|bit|date|year|time|datetime|timestamp|char|varchar|tinytext|text|mediumtext|longtext|binary|varbinary|tinyblob|blob|mediumblob|longblob|json|enum|set)\b/i;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function mysqlSyncSupported(info: TableInfo, names: string[], keys: string[]) {
  return info.columns.length === names.length && info.columns.every(column => names.includes(column.name) && types.test(column.type)) &&
    same(info.editableKey, keys) && same(info.primaryKey, keys) && keys.every(name => !info.columns.find(column => column.name === name)?.generated);
}

/** 只使用比较快照中的整行和已验证表结构。写入读取同一独占会话，右侧确认后不接受取消中断 COMMIT。 */
export async function applyMysqlDataSync(context: MysqlSyncContext, target: Target, evidence: MysqlSyncEvidence, rows: MysqlSyncRow[],
  commitProtected: () => void): Promise<PostgresTableOutcome> {
  const info = evidence.metadata.source, facts = emptyTableApplyEvidence();
  try {
    const toRow = (values: CellValue[]) => Object.fromEntries(evidence.columns.map((name, index) => [name, values[index]]));
    const selected = rows.map(({ before, after }) => ({ before: before && toRow(before), after: after && toRow(after) }));
    const order = (row: typeof selected[number]) => !row.after ? 0 : row.before ? 1 : 2;
    selected.sort((a, b) => order(a) - order(b));
    const changes: RowChange[] = selected.map(({ before, after }) => {
      if (!after) return { kind: 'delete', before: before! };
      const values = Object.fromEntries(info.columns.filter(column => !column.generated).map(column => {
        validateLosslessImport(column, after[column.name], context.managed.status.dialect);
        return [column.name, after[column.name]];
      }));
      return before ? { kind: 'update', before, values } : { kind: 'insert', values };
    });
    const table = qualified(target.database, target.table), projection = evidence.columns.map(identifier).join(', ');
    const reread = async (key: DataRow, expected: DataRow | undefined, locked: boolean) => {
      const keys = info.primaryKey.map(name => info.columns.find(column => column.name === name)!);
      const predicate = keys.map(column => identifier(column.name) + ' <=> ' + typedCellPlaceholder(column, key[column.name])).join(' AND ');
      const params = keys.map(column => deserializeCell(key[column.name]));
      const end = context.commandStarted();
      try {
        const result = await context.page('SELECT ' + projection + ' FROM ' + table + ' WHERE ' + predicate + ' LIMIT 2' + (locked ? ' FOR UPDATE' : ''), params);
        if (result.hasMore || result.rows.length !== (expected ? 1 : 0) || (expected &&
          !evidence.columns.every(name => same(expected[name], result.rows[0][name]))))
          throw Error(locked ? '右侧原值已变化，请重新比较' : '右侧写入回读值与冻结左侧值不一致');
      } finally { end(); }
    };

    for (const sql of [
      "SET SESSION time_zone = '+00:00'", 'SET SESSION innodb_lock_wait_timeout = 5', 'SET SESSION lock_wait_timeout = 5',
      'SET SESSION unique_checks = 1',
      "SET SESSION sql_mode = CONCAT_WS(',', NULLIF(@@SESSION.sql_mode,''), IF(FIND_IN_SET('NO_AUTO_VALUE_ON_ZERO', @@SESSION.sql_mode), NULL, 'NO_AUTO_VALUE_ON_ZERO'))",
    ]) header(await command(context, sql, undefined), false, 0);
    await configureTableFilteredDeleteForeignKeys(context);
    await applyTableTransaction(info, changes, {
      evidence: facts, strictSync: true, checkCancelled: context.checkCancelled, broken: () => context.managed.broken,
      cancelled: () => !!context.managed.signal?.aborted, emit: () => {},
      send: (sql, params, ack) => command(context, sql, params.length ? params.map(deserializeCell) : undefined,
        sql === 'COMMIT' ? commitProtected : undefined, ack),
      lockInfo: async () => {
        // 在独立事务内取得目标表元数据锁，再检查真实定义、授权、触发器及依赖。
        const end = context.commandStarted();
        try { await context.page('SELECT ' + projection + ' FROM ' + table + ' LIMIT 0 FOR UPDATE', []); }
        finally { end(); }
        const base = await readTarget(context, target);
        if (selected.some(row => !!row.before)) {
          const proof = await readTableFilteredDeleteTarget(context, target, base);
          if (proof.dependencies.length) throw Error('右侧表被外键引用，整批未写入');
        }
        if (base.definitionDigest !== evidence.metadata.definitionDigest || base.serverIdentity !== evidence.metadata.serverIdentity)
          throw Error('右侧表结构、权限或服务器已变化，请重新比较');
        for (const row of selected) if (row.before) await reread(row.before, row.before, true);
        return base.source;
      },
      afterWrite: index => {
        const row = selected[index];
        return reread(row.after ?? row.before!, row.after, false);
      },
      rollback: () => command(context, 'ROLLBACK', undefined, undefined, undefined, true),
    });
    return { outcome: 'committed', affected: facts.serverReportedRows, message: 'MySQL／MariaDB 已确认整批提交' };
  } catch (error) {
    if (facts.commitAcknowledged) return { outcome: 'committed', affected: facts.serverReportedRows, message: '已确认提交，请核对连接收尾' };
    const outcome = !facts.dmlMayHaveBeenSent ? 'notSent' : facts.rollbackAcknowledged && facts.transactionProtected ? 'rolledBack' : 'unknown';
    return { outcome, affected: 0, message: error instanceof Error ? error.message : String(error) };
  }
}
