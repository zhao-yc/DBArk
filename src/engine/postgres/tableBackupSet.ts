import { isAbsolute } from 'node:path';
import { postgresIdentifier } from '../../shared/postgresSql';
import { isPostgresSqlExportColumn, type PostgresBackupSetInput, type PostgresTableExportOutput } from '../../shared/postgresTable';
import { AtomicFile, nativeAtomicFileIO } from '../atomicFile';
import type { PostgresConnection } from './connection';
import { readPostgresSqlExportSettings, writePostgresSqlPreamble, writePostgresSqlRows, writePostgresSqlStatements } from './sqlExport';
import { readPostgresTableBackup } from './tableBackup';
import { validatePostgresExportRow } from './tableExport';
import { beginPostgresTableTransaction, readExportCursor, readRelation } from './tableWorkspace';

export type PostgresBackupSetRequest = PostgresBackupSetInput & { filePath: string };
type Connect = <T>(action: (connection: PostgresConnection) => Promise<T>) => Promise<T>;
const control = { rows: 1, bytes: 64 * 1024 };
const metadataBudget = 16 * 1024 * 1024;

/** 多表的锁、目录和游标共用同一个快照；连接确认收尾后才发布暂存的 SQL。 */
export async function exportPostgresBackupSet(input: PostgresBackupSetRequest, connect: Connect,
  check: () => void, commitStart: () => void, progress: (rows: number) => void): Promise<PostgresTableExportOutput> {
  if (!isAbsolute(input.filePath) || input.filePath.includes('\0')) throw Error('主进程未提供授权的备份路径');
  let file: AtomicFile | undefined, rows = 0;
  try {
    await connect(async connection => {
      check();
      await beginPostgresTableTransaction(connection, 'page');
      // 统一锁顺序，且在第一条目录查询建立快照之前锁定整个所选集合。
      const names = [...input.tables].sort();
      await connection.query('LOCK TABLE ' + names.map(name => 'ONLY ' + name).join(', ') + ' IN ACCESS SHARE MODE', undefined, control);
      await connection.query('SET LOCAL row_security = off', undefined, control);
      const plans = [];
      let metadata = 0;
      for (const name of names) {
        check();
        const relation = await readRelation(connection, name);
        const columns = relation.columns.filter(isPostgresSqlExportColumn);
        if (!columns.length) throw Error('所选表没有可写入字段，无法生成多表 SQL 备份');
        const plan = await readPostgresTableBackup(connection, name, relation.oid);
        metadata += Object.values(plan).flat().reduce((bytes, sql) => bytes + Buffer.byteLength(sql), 0);
        if (metadata > metadataBudget) throw Error('PostgreSQL 多表备份的结构超过 16 MiB 预算');
        plans.push({ name: relation.sql, columns, plan });
      }
      const settings = await readPostgresSqlExportSettings(connection);
      const staged = file = await AtomicFile.create(input.filePath, 'utf8', check, commitStart, nativeAtomicFileIO, undefined, undefined, true);
      const write = (sql: string) => staged.write(sql);
      await writePostgresSqlPreamble(settings, write, '多表备份');
      await writePostgresSqlStatements(plans.flatMap(({ plan }) => plan.sequences), write);
      await writePostgresSqlStatements(plans.map(({ plan }) => plan.table), write);
      await writePostgresSqlStatements(plans.flatMap(({ plan }) => plan.defaults), write);
      for (const { name, columns } of plans) {
        check();
        const declaration = await connection.query('DECLARE dbark_table_export NO SCROLL CURSOR FOR SELECT ' +
          columns.map(column => postgresIdentifier(column.name)).join(', ') + ' FROM ONLY ' + name, undefined, control);
        if (declaration.postgresCommand !== 'DECLARE') throw Error('PostgreSQL 多表备份游标未确认');
        async function* validated() {
          for await (const row of readExportCursor(connection, columns, check)) {
            validatePostgresExportRow(row);
            yield row;
          }
        }
        rows += await writePostgresSqlRows(name, columns, validated(), write, count => progress(rows + count));
        const closed = await connection.query('CLOSE dbark_table_export', undefined, control);
        if (closed.postgresCommand !== 'CLOSE') throw Error('PostgreSQL 多表备份游标未关闭');
      }
      // 所有表和索引完成后才安装外键，使双向引用和跨 schema 引用无需依赖创建顺序。
      await writePostgresSqlStatements(plans.flatMap(({ plan }) => plan.afterData), write);
      await writePostgresSqlStatements(plans.flatMap(({ plan }) => plan.foreignKeys), write);
      await writePostgresSqlStatements(plans.flatMap(({ plan }) => plan.finalize), write);
      await write('COMMIT;\n');
      await staged.prepare(true);
      check();
      const committed = await connection.query('COMMIT', undefined, control);
      if (committed.postgresCommand !== 'COMMIT' || !connection.state().transactionKnown || connection.state().transactionOpen)
        throw Error('PostgreSQL 多表备份的读取事务未完成');
    });
    check();
    if (!file) throw Error('PostgreSQL 多表备份未生成暂存文件');
    await file.commit();
    return { rows, fileCommitted: true };
  } finally {
    await file?.dispose();
  }
}
