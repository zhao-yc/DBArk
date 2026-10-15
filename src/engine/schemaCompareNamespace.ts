import type { SchemaCompareDifference } from '../shared/schemaCompare';
import type { SchemaComparisonSnapshot } from './schemaCompare';

/** 列、索引及 InnoDB 外键名不使用文件系统表名规则；保留原名，只用于冲突拒绝。 */
const folded = (name: string) => name.toLowerCase();
/** 精确类别与原名引用差异行；命名空间折叠不会改变报告中的名称。 */
export const comparisonRowKey = (row: Pick<SchemaCompareDifference, 'category' | 'name'>) => JSON.stringify([row.category, row.name]);

/** MySQL 及当前支持的 MariaDB 10.11/11.4 为库级；12.1 起的表级规则不提前套用。 */
function foreignKeyScope(snapshot: SchemaComparisonSnapshot): 'database' | 'table' | undefined {
  if (snapshot.context.dialect === 'mysql') return 'database';
  const version = /^(\d+)\.(\d+)\./.exec(snapshot.serverVersion.replace(/^5\.5\.5-/, ''));
  if (!version) return undefined;
  return Number(version[1]) > 12 || Number(version[1]) === 12 && Number(version[2]) >= 1 ? 'table' : 'database';
}

/** 库名/表名使用实测 lower_case_table_names；不把这项规则传播给字段和索引。 */
function relationNameEqual(a: string, b: string, snapshot: SchemaComparisonSnapshot): boolean | undefined {
  if (a === b) return true;
  if (snapshot.namespace?.identifierCase === 0) return false;
  if (snapshot.namespace) return folded(a) === folded(b);
  return folded(a) === folded(b) ? undefined : false;
}

/** 只做命名空间预检，不重配对、不推断重命名，也不把选中的删除视为自动名称映射。 */
export function compareNamespaceConflicts(source: SchemaComparisonSnapshot, target: SchemaComparisonSnapshot, selected: readonly SchemaCompareDifference[], targetNames: { columns: readonly string[]; indexes: readonly string[]; foreignKeys: readonly string[] }): ReadonlyMap<string, string[]> {
  const conflicts = new Map<string, string[]>();
  const add = (row: SchemaCompareDifference, reason: string) => { const key = comparisonRowKey(row); conflicts.set(key, [...(conflicts.get(key) ?? []), reason]); };
  const additions = selected.filter(row => row.status === 'added' && row.category !== 'unclassified');
  for (const row of additions) {
    const names = targetNames[row.category as keyof typeof targetNames];
    const collision = names.find(name => folded(name) === folded(row.name));
    if (collision !== undefined) add(row, `目标${row.category === 'columns' ? '字段' : row.category === 'indexes' ? '索引' : '外键'}命名空间已存在 ${JSON.stringify(collision)}，不能按仅大小写差异生成重复 ADD；请显式映射或重命名`);
    if (additions.some(other => other !== row && other.category === row.category && folded(other.name) === folded(row.name))) add(row, '所选新增项之间名称冲突，请显式映射或重命名');
    if (row.category !== 'foreignKeys' || foreignKeyScope(target) !== 'database') continue;
    const sameServer = source.namespace && target.namespace ? source.namespace.serverIdentity === target.namespace.serverIdentity : source.target.connectionId === target.target.connectionId || source.identity === target.identity ? true : undefined;
    const sameDatabase = relationNameEqual(source.target.database, target.target.database, target);
    const sameTable = relationNameEqual(source.target.table, target.target.table, target);
    if (sameServer === true && sameDatabase === true && sameTable !== true) add(row, '源外键名已被同一服务器同库的另一张源表占用，库级名称不能直接复制；请显式映射为新外键名并核验可用性');
    else if (sameDatabase !== false && (sameServer === undefined || sameServer && (sameDatabase === undefined || sameTable === undefined))) add(row, '无法证明两侧服务器或库级外键命名空间彼此独立；请重新比较并显式核验名称映射');
    // 两表快照无法排除目标库其它表占名；不同服务器也不是名称可用性证明。
    else add(row, '尚未核验目标库完整外键命名空间，不能确认该名称可用；请显式映射或重命名并核验，暂不生成外键新增');
  }
  return conflicts;
}
