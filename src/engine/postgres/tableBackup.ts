import { postgresDdlLiteral } from '../../shared/postgresCreateTable';
import { postgresIdentifier } from '../../shared/postgresSql';
import type { PostgresConnection } from './connection';
import { readPostgresStructureFacts } from './relationStructure';
import type { PostgresTableBackupSql } from './sqlExport';

const budget = { rows: 2048, bytes: 2 * 1024 * 1024 };
const integer = /^-?\d{1,19}$/;
const qualify = (schema: string, name: string) => postgresIdentifier(schema) + '.' + postgresIdentifier(name);

/** 只重建由当前表拥有的序列。其它默认值依赖目标库现有对象，不由备份改写。 */
async function ownedSequences(connection: PostgresConnection, oid: string) {
  const result = await connection.query(`
    SELECT a.attname, n.nspname, c.relname, pg_catalog.format_type(s.seqtypid, NULL),
      s.seqstart::text, s.seqincrement::text, s.seqmax::text, s.seqmin::text, s.seqcache::text, s.seqcycle, d.deptype
    FROM pg_catalog.pg_depend d
    JOIN pg_catalog.pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
    JOIN pg_catalog.pg_sequence s ON s.seqrelid = d.objid
    JOIN pg_catalog.pg_class c ON c.oid = s.seqrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE d.refobjid = $1::oid AND d.classid = 'pg_catalog.pg_class'::regclass
      AND d.refclassid = 'pg_catalog.pg_class'::regclass AND d.deptype IN ('a', 'i')
    ORDER BY a.attnum, s.seqrelid
  `, [oid], budget);
  if (result.truncated) throw Error('PostgreSQL 备份序列目录超出预算');
  const sequences = new Map<string, { name: string; identity: boolean; type: string; options: string; state: string }>();
  for (const row of result.rows) {
    const { c0: column, c1: schema, c2: sequence, c3: type, c4: start, c5: increment, c6: max, c7: min, c8: cache, c9: cycle, c10: dependency } = row;
    if (typeof column !== 'string' || typeof schema !== 'string' || typeof sequence !== 'string' ||
      typeof type !== 'string' || !['smallint', 'integer', 'bigint'].includes(type) || !['t', 'f'].includes(String(cycle)) ||
      ![start, increment, max, min, cache].every(value => typeof value === 'string' && integer.test(value)) || sequences.has(column))
      throw Error('PostgreSQL 备份无法完整辨认字段所属序列');
    const name = qualify(schema, sequence);
    const options = `START WITH ${start} INCREMENT BY ${increment} MINVALUE ${min} MAXVALUE ${max} CACHE ${cache} ${cycle === 't' ? 'CYCLE' : 'NO CYCLE'}`;
    const state = await connection.query('SELECT last_value::text, is_called FROM ' + name, undefined, budget);
    const current = state.rows[0];
    if (state.truncated || state.rows.length !== 1 || typeof current?.c0 !== 'string' || !integer.test(current.c0) ||
      (current.c1 !== 't' && current.c1 !== 'f')) throw Error('PostgreSQL 序列当前值未完整返回');
    sequences.set(column, { name, identity: dependency === 'i', type, options,
      state: `SELECT pg_catalog.setval(${postgresDdlLiteral(name)}::pg_catalog.regclass, ${current.c0}, ${current.c1 === 't' ? 'true' : 'false'})` });
  }
  return sequences;
}

/** 在持有原表读取锁的同一事务生成结构。数据导完再建约束、索引和用户触发器。 */
export async function readPostgresTableBackup(connection: PostgresConnection, table: string, expectedOid: string): Promise<PostgresTableBackupSql> {
  const guard = await connection.query(`
    SELECT am.amname
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_am am ON am.oid = c.relam
    WHERE c.oid = $1::oid AND c.relkind = 'r' AND c.relpersistence = 'p'
      AND NOT c.relispartition AND NOT c.relrowsecurity AND NOT c.relhasrules
      AND NOT EXISTS (SELECT FROM pg_catalog.pg_inherits i WHERE i.inhrelid = c.oid OR i.inhparent = c.oid)
      AND pg_catalog.has_table_privilege(c.oid, 'SELECT')
  `, [expectedOid], budget);
  const method = guard.rows[0]?.c0;
  if (guard.truncated || guard.rows.length !== 1 || typeof method !== 'string')
    throw Error('整表 SQL 备份需要可读取的普通持久表，分区、继承表、行级安全和重写规则暂不支持');
  // 让服务器反编译时补齐用户 schema；回放采用同一搜索路径，避免在目标上解析成同名对象。
  await connection.query('SET LOCAL search_path = pg_catalog', undefined, budget);
  const { output, oid } = await readPostgresStructureFacts(connection, table);
  if (oid !== expectedOid || output.kind !== 'r' || output.rowSecurity || output.forceRowSecurity)
    throw Error('PostgreSQL 备份的原表结构已变化');
  if (output.indexes.some(index => !index.valid || !index.ready) || output.constraints.some(constraint => constraint.inherited))
    throw Error('PostgreSQL 备份遇到未完成的索引或继承约束');
  if (output.constraints.some(constraint => constraint.kind === 'n' && !constraint.validated))
    throw Error('PostgreSQL 备份暂不支持未验证的非空约束');

  const name = qualify(output.schema, output.name);
  const sequences = await ownedSequences(connection, oid);
  const beforeData: string[] = [], afterData: string[] = [];
  for (const sequence of sequences.values()) {
    if (!sequence.identity) beforeData.push(`CREATE SEQUENCE ${sequence.name} AS ${sequence.type} ${sequence.options}`);
  }
  const definitions = output.columns.map(column => {
    const identifier = postgresIdentifier(column.name), sequence = sequences.get(column.name);
    let declaration = identifier + ' ' + column.type;
    if (column.collation && column.collation !== 'pg_catalog."default"') declaration += ' COLLATE ' + column.collation;
    if (column.identity) {
      if (!sequence?.identity || sequence.type !== column.type) throw Error('PostgreSQL 标识列的序列类型未完整核对');
      declaration += ` GENERATED ${column.identity === 'a' ? 'ALWAYS' : 'BY DEFAULT'} AS IDENTITY (SEQUENCE NAME ${sequence.name} ${sequence.options})`;
    } else if (column.generation) {
      if (!column.generationExpression) throw Error('PostgreSQL 生成列表达式未完整读取');
      declaration += ` GENERATED ALWAYS AS (${column.generationExpression}) ${column.generation === 's' ? 'STORED' : 'VIRTUAL'}`;
    } else if (column.defaultExpression !== null) declaration += ' DEFAULT ' + column.defaultExpression;
    if (!column.nullable) declaration += ' NOT NULL';
    if (sequence && !sequence.identity) afterData.push(`ALTER SEQUENCE ${sequence.name} OWNED BY ${name}.${identifier}`);
    if (column.comment !== null) afterData.push(`COMMENT ON COLUMN ${name}.${identifier} IS ${postgresDdlLiteral(column.comment)}`);
    return declaration;
  });
  beforeData.push(`CREATE TABLE ${name} (\n  ${definitions.join(',\n  ')}\n) USING ${postgresIdentifier(method)}`);
  if (output.comment !== null) afterData.push(`COMMENT ON TABLE ${name} IS ${postgresDdlLiteral(output.comment)}`);
  const constraints = output.constraints.filter(item => item.kind !== 'n');
  for (const item of constraints.filter(item => item.kind !== 'f')) {
    afterData.push(`ALTER TABLE ONLY ${name} ADD CONSTRAINT ${postgresIdentifier(item.name)} ${item.definition}`);
  }
  for (const index of output.indexes) {
    if (!index.constraint) afterData.push(index.definition);
  }
  // 自引用外键可以依赖本表单独创建的唯一索引，必须在索引之后恢复。
  for (const item of constraints.filter(item => item.kind === 'f')) {
    afterData.push(`ALTER TABLE ONLY ${name} ADD CONSTRAINT ${postgresIdentifier(item.name)} ${item.definition}`);
  }
  const triggers = await connection.query(`
    SELECT tgname, pg_catalog.pg_get_triggerdef(oid, false), tgenabled
    FROM pg_catalog.pg_trigger WHERE tgrelid = $1::oid AND NOT tgisinternal ORDER BY tgname
  `, [oid], budget);
  if (triggers.truncated) throw Error('PostgreSQL 用户触发器目录超出备份预算');
  const states = new Map([['O', ''], ['D', 'DISABLE'], ['A', 'ENABLE ALWAYS'], ['R', 'ENABLE REPLICA']]);
  for (const row of triggers.rows) {
    if (typeof row.c0 !== 'string' || typeof row.c1 !== 'string' || !states.has(String(row.c2)))
      throw Error('PostgreSQL 用户触发器定义未完整返回');
    afterData.push(row.c1);
    const state = states.get(String(row.c2));
    if (state) afterData.push(`ALTER TABLE ONLY ${name} ${state} TRIGGER ${postgresIdentifier(row.c0)}`);
  }
  for (const sequence of sequences.values()) afterData.push(sequence.state);
  return { beforeData, afterData };
}
