import type { SqliteCompletionAnalysis, SqliteCompletionRelation } from '../shared/sqliteCompletionAnalysis';
import { foldSqliteCompletionName as fold, sqliteCompletionLimits, type SqliteCompletionEntry } from '../shared/sqliteCompletion';
import type { SqliteCompletionDirectory } from './sqliteCompletionSuggestions';
import { sqliteFieldHoverZh as text } from './locales/sqliteFieldHover.zh-CN';

/** 仅显示代码块纯文本；名称及声明类型不能变成HTML、外链或可执行Monaco命令。 */
function markdown(lines: string[]): string { return lines.join('\n').split(/\r\n|\r|\n/).map(line => '    ' + line).join('\n'); }
const display = (value: string) => JSON.stringify(value);

/** 精确字段解析须检查全部可见绑定；目录不完整或同名歧义时不猜测某个物理来源。 */
export async function sqliteFieldHover(analysis: Extract<SqliteCompletionAnalysis, { status: 'ready' }>, directory: SqliteCompletionDirectory): Promise<string | undefined> {
  if (!analysis.syntax.includes('column') || !analysis.target.prefix) return;
  const name = analysis.target.prefix, qualifiers = analysis.qualifiers;
  const bound = analysis.relations.filter(relation => relation.kind === 'physical' || !relation.declaration);
  const matches = (relation: SqliteCompletionRelation) => !qualifiers.length || qualifiers.length === 1 && fold(relation.alias ?? relation.name) === fold(qualifiers[0]) || qualifiers.length === 2 && relation.kind === 'physical' && !relation.alias && relation.schema !== undefined && fold(relation.schema) === fold(qualifiers[0]) && fold(relation.name) === fold(qualifiers[1]);
  const selected = bound.filter(matches);
  if (!selected.length || qualifiers.length && selected.length !== 1) return;
  const candidates: { relation: SqliteCompletionRelation; column: string; entry?: Extract<SqliteCompletionEntry, { kind: 'column' }> }[] = [];
  let prefix = name.slice(0, sqliteCompletionLimits.prefixUnits);
  if (/[\uD800-\uDBFF]$/.test(prefix)) prefix = prefix.slice(0, -1);
  // 未限定字段按最近查询块逐层找；内层已存在的字段不会被同名外层字段误报为歧义。
  const depths = [...new Set(selected.map(relation => relation.scopeDepth ?? 0))].sort((a, b) => b - a);
  for (const depth of depths) {
  for (const relation of selected.filter(relation => (relation.scopeDepth ?? 0) === depth)) {
    if (relation.kind === 'local') {
      for (const column of relation.columns) if (fold(column) === fold(name)) candidates.push({ relation, column });
    } else {
      const result = await directory.load({ kind: 'columns', table: relation.name, prefix, ...(relation.schema ? { schema: relation.schema } : {}) });
      if (result.incomplete) return;
      for (const entry of result.entries) if (entry.kind === 'column' && fold(entry.name) === fold(name)) candidates.push({ relation, column: entry.name, entry });
    }
  }
  if (candidates.length) break;
  }
  if (candidates.length !== 1) return;
  const { relation, column, entry } = candidates[0];
  const lines = [text.title, text.column + '：' + display(column), text.binding + '：' + display(relation.alias ?? relation.name)];
  if (entry) {
    lines.push(text.source + '：' + display(entry.schema) + '.' + display(entry.table), entry.schema === 'temp' ? text.temporary : text.permanent,
      text.declaredType + '：' + (entry.declaredType ? display(entry.declaredType) : text.noDeclaredType), text.generated + '：' + (entry.generated ? text.yes : text.no), text.hidden + '：' + (entry.hidden ? text.yes : text.no), text.dynamic);
  } else if (relation.kind === 'local') lines.push(text.source + '：' + (relation.source === 'cte' ? text.cte : text.derived), text.unknown);
  return markdown(lines);
}
