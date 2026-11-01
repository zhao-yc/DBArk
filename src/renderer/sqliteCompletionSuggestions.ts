import type { SqliteCompletionAnalysis, SqliteCompletionRelation } from '../shared/sqliteCompletionAnalysis';
import { foldSqliteCompletionName as fold, quoteSqliteCompletionName as quote, sqliteCompletionLimits, type SqliteCompletionLookup, type SqliteCompletionOutput } from '../shared/sqliteCompletion';
import { sqliteCompletionZh as text } from './locales/sqliteCompletion.zh-CN';

export interface SqliteCompletionItem { label: string; kind: 'database' | 'table' | 'view' | 'column' | 'alias' | 'keyword'; insertText: string; detail: string; trigger?: boolean; }
export interface SqliteCompletionDirectory { load(query: SqliteCompletionLookup): Promise<SqliteCompletionOutput>; }
const keywords = ['SELECT', 'FROM', 'WHERE', 'JOIN', 'LEFT JOIN', 'INNER JOIN', 'ON', 'GROUP BY', 'HAVING', 'ORDER BY', 'LIMIT', 'OFFSET', 'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM', 'WITH', 'AS', 'DISTINCT', 'UNION ALL', 'IS NULL', 'IS NOT NULL', 'RETURNING'];
/** 建议只引用准确目录名；同名字段保留不同别名的限定插入，CTE声明不伪装成FROM绑定。 */
export async function sqliteCompletionSuggestions(analysis: Extract<SqliteCompletionAnalysis, { status: 'ready' }>, directory: SqliteCompletionDirectory): Promise<{ items: SqliteCompletionItem[]; incomplete: boolean }> {
  const items: SqliteCompletionItem[] = [], seen = new Set<string>(), prefix = fold(analysis.target.prefix), qualifiers = analysis.qualifiers;
  let incomplete = false;
  const add = (item: SqliteCompletionItem) => {
    if (!fold(item.label).startsWith(prefix)) return;
    const key = item.kind + '\0' + item.insertText;
    if (seen.has(key)) return;
    if (items.length >= sqliteCompletionLimits.suggestions) { incomplete = true; return; }
    seen.add(key); items.push(item);
  };
  const bound = analysis.relations.filter(relation => relation.kind === 'physical' || !relation.declaration);
  const declarations = analysis.relations.filter(relation => relation.kind === 'local' && relation.declaration);
  if (analysis.syntax.includes('relation') && qualifiers.length <= 1) {
    const schema = qualifiers.length === 1 && ['main', 'temp'].includes(fold(qualifiers[0])) ? fold(qualifiers[0]) as 'main' | 'temp' : undefined;
    if (!qualifiers.length || schema) {
      if (!schema) {
        for (const local of declarations) add({ label: local.name, kind: 'table', insertText: quote(local.name), detail: text.cte });
        for (const namespace of ['main', 'temp']) add({ label: namespace, kind: 'database', insertText: quote(namespace) + '.', detail: text.schema, trigger: true });
      }
      const metadata = await directory.load({ kind: 'relations', prefix: analysis.target.prefix, ...(schema ? { schema } : {}) }); incomplete ||= metadata.incomplete;
      const shadowed = new Set(declarations.map(relation => fold(relation.name)));
      for (const entry of metadata.entries) {
        if (entry.kind === 'column' || !schema && shadowed.has(fold(entry.name))) continue;
        add({ label: entry.name, kind: entry.kind, insertText: quote(entry.name), detail: (entry.kind === 'view' ? text.view : text.table) + ' · ' + entry.schema + (entry.schema === 'temp' ? ' · ' + text.temporary : '') });
      }
    }
  }
  /** 名称限定采用SQLite的ASCII比较；别名一旦存在，不把旧表名再当别名。 */
  const matches = (relation: SqliteCompletionRelation) => !qualifiers.length || qualifiers.length === 1 && fold(relation.alias ?? relation.name) === fold(qualifiers[0]) || qualifiers.length === 2 && relation.kind === 'physical' && !relation.alias && relation.schema !== undefined && fold(relation.schema) === fold(qualifiers[0]) && fold(relation.name) === fold(qualifiers[1]);
  if (analysis.syntax.includes('column')) {
    const selected = bound.filter(matches);
    if (qualifiers.length && selected.length > 1) return { items: [], incomplete: true };
    for (const relation of selected) {
      const binding = relation.alias ?? relation.name;
      // INSERT列清单由分析器仅投影目标表；已有点限定时只替换最后的字段。
      const insert = (name: string) => qualifiers.length || analysis.unqualifiedColumns ? quote(name) : quote(binding) + '.' + quote(name);
      if (relation.kind === 'local') {
        for (const name of relation.columns) add({ label: name, kind: 'column', insertText: insert(name), detail: binding + ' · ' + (relation.source === 'cte' ? text.cte : text.derived) });
      } else {
        const metadata = await directory.load({ kind: 'columns', table: relation.name, prefix: analysis.target.prefix, ...(relation.schema ? { schema: relation.schema } : {}) }); incomplete ||= metadata.incomplete;
        for (const entry of metadata.entries) if (entry.kind === 'column') add({ label: entry.name, kind: 'column', insertText: insert(entry.name), detail: binding + ' · ' + entry.schema + ' · ' + (entry.declaredType || text.column) + (entry.generated ? ' · ' + text.generated : '') + (entry.hidden ? ' · ' + text.hidden : '') });
      }
      if (!qualifiers.length) add({ label: binding, kind: 'alias', insertText: quote(binding) + '.', detail: text.alias, trigger: true });
    }
  }
  if (analysis.syntax.includes('keyword') && !analysis.target.quoted && !qualifiers.length) for (const keyword of keywords) add({ label: keyword, kind: 'keyword', insertText: keyword, detail: text.keyword });
  return { items, incomplete };
}
