import { assertSqliteIncomingOutput, type SqliteIncomingOutput } from '../shared/sqliteIncoming';
import { sqliteTableRelationSchema, type SqliteTableRelation } from '../shared/sqliteTableBrowse';
import { sqliteRelationshipName as fold } from '../shared/sqliteRelationships';
import { isSqliteRelatedTabId } from '../shared/sqliteRelatedTab';

export interface SqliteRelatedTableScope { readonly relation: SqliteTableRelation; current(): boolean; invalidate(): void; }
const scopes = new Map<string, SqliteRelatedTableScope>();
/** 只从完整校验过的子页创建固定关联，不从显示字符串或普通筛选猜父亲和性。 */
export function sqliteRelatedTableRelation(raw: SqliteIncomingOutput): SqliteTableRelation {
  const output = assertSqliteIncomingOutput(raw, raw.request), input = output.request, entry = output.references[0];
  if (input.incoming !== 'page' || !output.page || !entry.referencedColumns) throw Error('请先明确读取准确关联子页');
  return sqliteTableRelationSchema.parse({ parentTable: input.table, parentSchemaKey: input.schemaKey, childSchemaKey: input.childSchemaKey, foreignKey: input.foreignKey, parentColumns: entry.referencedColumns,
    childColumns: entry.key.columns.map(name => output.page!.columns.find(column => fold(column.name) === fold(name))?.name), values: input.values });
}
/** 递归冻结来源；关闭标签或连接／目标变化留下永久墓碑，恢复同一ID不能复活关联。 */
export function registerSqliteRelatedTable(id: string, relation: SqliteTableRelation, guard: () => boolean): SqliteRelatedTableScope {
  if (!isSqliteRelatedTabId(id) || scopes.has(id)) throw Error('SQLite关联表页编号重复或无效');
  const freeze = <T,>(value: T): T => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
  const captured = freeze(sqliteTableRelationSchema.parse(relation)); let dead = false;
  const scope: SqliteRelatedTableScope = { relation: captured, current() { if (!dead) try { if (guard() !== true) dead = true; } catch { dead = true; } if (dead && scopes.get(id) === scope) scopes.delete(id); return !dead; }, invalidate() { dead = true; if (scopes.get(id) === scope) scopes.delete(id); } };
  scopes.set(id, scope); return scope;
}
/** 只认当前进程的来源，不从settings、标题或表名重建丢失的父值。 */
export function sqliteRelatedTableScope(id: string): SqliteRelatedTableScope | undefined { return scopes.get(id); }

/** 守卫只捕获新标签目标与连接身份，不让独立页长期强引用原组件或原行草稿。 */
export function sqliteRelatedTargetGuard(peek: () => { settings: { tabs: readonly { id: string; kind: string; connectionId: string; database?: string; table?: string }[] }; connections: readonly unknown[]; connectionVersions: Record<string, number> }, target: { id: string; connectionId: string; table: string; profile: unknown; version: number }): () => boolean {
  return () => { const state = peek(), tab = state.settings.tabs.find(item => item.id === target.id); return tab?.kind === 'table' && tab.connectionId === target.connectionId && tab.database === 'main' && tab.table === target.table && state.connections.includes(target.profile) && (state.connectionVersions[target.connectionId] ?? 0) === target.version; };
}
/** 订阅属于新标签生命周期，不借原Modal闭包保留大页或编辑器。 */
export function watchSqliteRelatedScope(scope: SqliteRelatedTableScope, subscribe: (listener: () => void) => () => void): void {
  let stop = () => {}; stop = subscribe(() => { if (!scope.current()) stop(); }); if (!scope.current()) stop();
}
