import { createHash } from 'node:crypto';
import { tableFilteredDeleteText as text, type TableFilteredDeleteTarget } from '../shared/tableFilteredDelete';
import { tableFilteredUpdateText } from '../shared/tableFilteredUpdate';
import { tableDefinitionTokens } from './tableColumnDefinition';
import type { TableDefinitionContext } from '../shared/tableColumnPatches';
import { command, header, readTarget as readBaseTarget } from './tableFilteredUpdateProtocol';
import { structureTaskQuery, type StructureTaskContext } from './structureDefinition';

const literal = (value: string) => `_utf8mb4 X'${Buffer.from(value, 'utf8').toString('hex')}'`;
interface Dependency { databaseName: string; tableName: string; constraintName: string; parentDatabase: string; parentTable: string; onDelete: string; }

/** 底层复用协议和spool的已知错误换成删除文案；真实驱动错误保留，不伪造成功。 */
export function tableFilteredDeleteFailure(reason: unknown): unknown {
  if (!(reason instanceof Error)) return reason;
  for (const [key, message] of Object.entries(tableFilteredUpdateText)) {
    if (reason.message === message) return new Error((text as Record<string, string>)[key] ?? text.invalid, { cause: reason });
  }
  return reason;
}

/** 必须具有直接全局 SELECT 才能证明跨库反向外键目录完整；角色及局部授权不能猜作全局。 */
export function tableFilteredDeleteGlobalVisibility(grants: readonly string[], mode: TableDefinitionContext): boolean {
  let proven = false;
  for (const grant of grants) {
    const tokens = tableDefinitionTokens(grant, mode), word = (index: number) => tokens[index]?.kind === 'word' ? tokens[index].value.toUpperCase() : '';
    if (word(0) === 'REVOKE' || tokens.some(token => token.kind === 'executable')) return false;
    const on = tokens.findIndex((_, index) => word(index) === 'ON');
    if (word(0) !== 'GRANT' || on < 2 || tokens[on + 1]?.kind !== 'symbol' || tokens[on + 1]?.value !== '*' || tokens[on + 2]?.value !== '.' || tokens[on + 3]?.kind !== 'symbol' || tokens[on + 3]?.value !== '*' || word(on + 4) !== 'TO') continue;
    const privileges = grant.slice(tokens[1].start, tokens[on].start).toUpperCase().split(',').map(value => value.trim());
    if (privileges.some(value => ['ALL', 'ALL PRIVILEGES', 'SELECT'].includes(value))) proven = true;
  }
  return proven;
}
/** 仅规范本次独立会话，绝不继承关闭的外键检查或修改父会话／全局配置。 */
export async function configureTableFilteredDeleteForeignKeys(context: StructureTaskContext): Promise<void> {
  header(await command(context, 'SET SESSION foreign_key_checks=1', undefined), false, 0);
  await assertTableFilteredDeleteForeignKeys(context);
}
/** 每次完整目录校验同时确认实际约束生效，RESTRICT不能被连接默认值绕过。 */
async function assertTableFilteredDeleteForeignKeys(context: StructureTaskContext): Promise<void> {
  const rows = (await structureTaskQuery<Record<string, unknown>[]>(context, 'SELECT CAST(@@SESSION.foreign_key_checks AS CHAR) AS foreignKeyChecks')).rows;
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0] || Reflect.ownKeys(rows[0]).length !== 1 || rows[0].foreignKeyChecks !== '1') throw Error(text.dependencies);
}
/** 按精确父库表读取全部反向规则；有限上限只用于拒绝，绝不截断后继续删除。 */
export function tableFilteredDeleteDependenciesSql(target: TableFilteredDeleteTarget): string {
  return `SELECT CONSTRAINT_SCHEMA AS databaseName,TABLE_NAME AS tableName,CONSTRAINT_NAME AS constraintName,UNIQUE_CONSTRAINT_SCHEMA AS parentDatabase,REFERENCED_TABLE_NAME AS parentTable,DELETE_RULE AS onDelete FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CAST(UNIQUE_CONSTRAINT_SCHEMA AS BINARY)=CAST(${literal(target.database)} AS BINARY) AND CAST(REFERENCED_TABLE_NAME AS BINARY)=CAST(${literal(target.table)} AS BINARY) ORDER BY CAST(CONSTRAINT_SCHEMA AS BINARY),CAST(TABLE_NAME AS BINARY),CAST(CONSTRAINT_NAME AS BINARY) LIMIT 4097`;
}
/** 只放行 RESTRICT／NO ACTION；未知、CASCADE及SET NULL均可能越出快照行范围。 */
export function validateTableFilteredDeleteDependencies(value: unknown, target: TableFilteredDeleteTarget): Dependency[] {
  const fields = ['databaseName', 'tableName', 'constraintName', 'parentDatabase', 'parentTable', 'onDelete'];
  if (!Array.isArray(value) || value.length > 4096) throw Error(text.dependencies);
  const seen = new Set<string>();
  return value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Reflect.ownKeys(item).length !== fields.length || fields.some(field => !Object.getOwnPropertyDescriptor(item, field)?.enumerable || !('value' in Object.getOwnPropertyDescriptor(item, field)!))) throw Error(text.dependencies);
    const row = item as Dependency;
    if (fields.some(field => typeof row[field as keyof Dependency] !== 'string') || [row.databaseName, row.tableName, row.constraintName].some(name => !name || name.length > 64 || name.includes('\0')) || row.parentDatabase !== target.database || row.parentTable !== target.table || !['RESTRICT', 'NO ACTION'].includes(row.onDelete)) throw Error(text.dependencies);
    const key = JSON.stringify([row.databaseName, row.tableName, row.constraintName]); if (seen.has(key)) throw Error(text.dependencies); seen.add(key);
    return { databaseName: row.databaseName, tableName: row.tableName, constraintName: row.constraintName, parentDatabase: row.parentDatabase, parentTable: row.parentTable, onDelete: row.onDelete };
  });
}
/** 原读取函数继续核完整DDL及触发器；本用途额外核跨库可见性和前后相同的反向外键目录。 */
export async function readTableFilteredDeleteTarget(context: StructureTaskContext, target: TableFilteredDeleteTarget) {
  await assertTableFilteredDeleteForeignKeys(context);
  const base = await readBaseTarget(context, target);
  const grants = (await structureTaskQuery<Record<string, unknown>[]>(context, 'SHOW GRANTS')).rows;
  if (!Array.isArray(grants) || grants.length > 256 || Buffer.byteLength(JSON.stringify(grants)) > 512 * 1024) throw Error(text.dependencies);
  const grantTexts = grants.map(row => { const values = Object.values(row); if (values.length !== 1 || typeof values[0] !== 'string') throw Error(text.dependencies); return values[0]; });
  if (!tableFilteredDeleteGlobalVisibility(grantTexts, base.context)) throw Error(text.dependencies);
  const dependencies = validateTableFilteredDeleteDependencies((await structureTaskQuery<unknown>(context, tableFilteredDeleteDependenciesSql(target))).rows, target);
  return { ...base, dependencies, definitionDigest: createHash('sha256').update(JSON.stringify([base.definitionDigest, dependencies])).digest('hex') };
}
