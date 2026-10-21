import type { CompletionAnalysisReady, CompletionRelation } from '../shared/completionAnalysis';
import { completionAliasIdentifier, completionIdentifier } from '../shared/completionLexical';
import type { CompletionDirectoryRequest, CompletionMetadataEntry, CompletionMetadataOutput } from '../shared/sqlCompletion';
import { copyCompletionColumnDetails } from '../shared/completionColumnDetails';
import { sqlFieldHoverZh as text } from './locales/sqlFieldHover.zh-CN';

interface Directory { load(query: CompletionDirectoryRequest, signal?: AbortSignal): Promise<CompletionMetadataOutput>; }
interface Candidate { relation: string; column: string; source: string; database?: string; table?: string; entry?: CompletionMetadataEntry; }
/** 精确名称优先；只采用MySQL列名共有的ASCII大小写规则，不猜Unicode折叠或重音。 */
function sameName(left: string, right: string): boolean { return left === right || /^[\x00-\x7f]+$/.test(left + right) && left.toLowerCase() === right.toLowerCase(); }
const display = (value: string) => JSON.stringify(value);
/** 全文作为缩进代码块，数据库备注、默认值和名称不能成为HTML、链接或命令。 */
function markdown(lines: string[]): string { return lines.join('\n').split(/\r\n|\r|\n/).map(line => '    ' + line).join('\n'); }

/** 只消费本地作用域和有界目录；不执行SQL，也不推断计算列或不确定来源的类型。 */
export async function sqlFieldHover(analysis: CompletionAnalysisReady, database: string | undefined, directory: Directory, signal?: AbortSignal): Promise<string | undefined> {
  const target = analysis.target, name = target.prefix;
  if (signal?.aborted || !analysis.syntax.includes('column') || analysis.windowNames !== undefined || !completionAliasIdentifier(name) || target.qualifiers.length > 2) return;
  const output = analysis.outputAliases;
  if (!target.qualifiers.length && output && (output.union || output.aliases.some(alias => sameName(alias, name)))) {
    if (![...output.aliases, ...output.columns].some(alias => sameName(alias, name))) return;
    return markdown([text.field + '：' + display(name), text.source + '：' + text.output, text.type + '：' + text.expression]);
  }
  const selected = target.qualifiers.length === 1 ? analysis.relations.filter(relation => relation.name === target.qualifiers[0]) : target.qualifiers.length === 2 ? analysis.relations.filter(relation => relation.source === 'table' && !relation.aliased && (relation.database ?? database) === target.qualifiers[0] && relation.table === target.qualifiers[1]) : analysis.relations;
  if (!selected.length || selected.length > 8 || target.qualifiers.length && selected.length !== 1 || !target.qualifiers.length && analysis.incomplete) return;
  /** 显式本地投影只报告已知名称；星号转发必须只有一个完整目录来源。 */
  async function read(relation: CompletionRelation): Promise<Candidate[]> {
    const local = relation.source !== 'table', names = relation.columns.filter(column => sameName(column, name));
    if (local && names.length) {
      if (names.length !== 1) throw Error('本地字段来源不唯一');
      return [{ relation: relation.name, column: names[0], source: relation.source === 'cte' ? text.cte : text.derived }];
    }
    if (!completionIdentifier(name) || relation.incomplete || relation.catalogs.length !== 1) throw Error('字段来源未完整确认');
    const source = relation.catalogs[0], schema = source.database ?? database;
    if (!completionIdentifier(schema) || !completionIdentifier(source.table)) throw Error('字段默认库未确认');
    const value = await directory.load({ kind: 'columns', database: schema, table: source.table, prefix: name, details: true }, signal);
    if (signal?.aborted || value.incomplete || value.sessionUncertain || value.entries.length > 2) throw Error('字段目录不完整');
    const matches = value.entries.filter(entry => entry.kind === 'column' && sameName(entry.name, name) && (!local || entry.visible === true));
    if (matches.length > 1 || matches.some(entry => entry.sessionObject === 'unconfirmed')) throw Error('字段来源不唯一');
    return matches.map(entry => {
      if (entry.dataType !== undefined && (typeof entry.dataType !== 'string' || entry.dataType.length > 64)) throw Error('字段类型摘要无效');
      const safe = { ...entry, ...(entry.details ? { details: copyCompletionColumnDetails(entry.details) } : {}) };
      return { relation: relation.name, column: entry.name, database: schema, table: source.table, source: entry.sessionObject === 'temporary' ? text.temporary : text.permanent, entry: safe };
    });
  }
  let candidates: Candidate[];
  try { candidates = (await Promise.all(selected.map(read))).flat(); } catch { return; }
  if (signal?.aborted || !candidates.length) return;
  if (candidates.length > 1) return markdown([text.ambiguous, ...candidates.map(candidate => display(candidate.relation) + '.' + display(candidate.column))]);
  const candidate = candidates[0], details = candidate.entry?.details;
  const lines = [text.field + '：' + display(candidate.relation) + '.' + display(candidate.column), text.source + '：' + candidate.source];
  if (candidate.database) lines.push(display(candidate.database) + '.' + display(candidate.table!));
  if (details) {
    lines.push(text.type + '：' + display(details.type), text.nullable + '：' + (details.nullable ? text.yes : text.no), text.defaultValue + '：' + (details.defaultValue === null ? text.noDefault : display(details.defaultValue)), text.extra + '：' + (details.extra ? display(details.extra) : text.none), text.comment + '：' + (details.comment ? display(details.comment) : text.none));
  } else {
    lines.push(text.baseType + '：' + (candidate.entry?.dataType ?? text.unknown));
    if (candidate.entry?.sessionObject === 'temporary') lines.push(text.readTemporary);
    else lines.push(text.type + '：' + text.expression);
  }
  return markdown(lines);
}
