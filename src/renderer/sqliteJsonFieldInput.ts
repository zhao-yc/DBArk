import { sqliteEditValueSchema, sqliteTableEditLimits, type SqliteEditColumn, type SqliteOriginalValue } from '../shared/sqliteTableEdit';
import { beginJsonNodeInput, changeJsonNodeInput, applyJsonNodeInput, type JsonNodeInput } from './jsonNodeInput';
import { applyJsonStructureAction } from './jsonStructureInput';
import { moveJsonObjectMember } from './jsonObjectMemberMove';
import { boundedUtf8Bytes, jsonLexicalLimits, lexicalNodeAtPath, type LexicalPathSegment, type ReadyLexicalDocument } from './jsonLexicalTree';
import type { RecordStructureAction, RecordStructureKind } from './recordJsonStructureInput';
import { recordJsonStructureInputZh as structureText } from './locales/recordJsonStructureInput.zh-CN';
import { objectMemberMoveZh as moveText } from './locales/objectMemberMove.zh-CN';
import { sqliteRecordTreeZh as text } from './locales/sqliteRecordTree.zh-CN';

export interface SqliteJsonFieldInput {
  readonly source: SqliteOriginalValue;
  readonly base: { readonly session: object; readonly columnName: string; readonly value: JsonNodeInput };
  readonly action?: RecordStructureAction;
}
/** 节点编辑只接受当前TEXT完整原文；声明名为JSON不代表实际值一定是TEXT。 */
export function beginSqliteJsonFieldInput(column: SqliteEditColumn, source: SqliteOriginalValue | undefined, document: ReadyLexicalDocument, segments: readonly LexicalPathSegment[], kind?: RecordStructureKind): SqliteJsonFieldInput {
  if (!source || source.kind !== 'text' || source.value !== document.text) throw Error(text.stale);
  if (column.generated || source.value.length > sqliteTableEditLimits.valueUnits) throw Error(text.readonly);
  const value = beginJsonNodeInput(document, segments), base = Object.freeze({ session: {}, columnName: column.name, value });
  if (!kind) return Object.freeze({ source, base });
  const node = value.node, last = segments.at(-1); let action: RecordStructureAction;
  if (kind === 'rename') {
    if (!last) throw Error(structureText.root); if (last.kind !== 'member') throw Error(structureText.member);
    const parent = lexicalNodeAtPath(document, { document, segments: segments.slice(0, -1) }); if (parent?.kind !== 'object') throw Error(structureText.member);
    const span = parent.members[last.memberIndex].keySpan; action = { kind, keyToken: document.text.slice(span.start, span.end) };
  } else if (kind === 'remove') { if (!last) throw Error(structureText.root); action = { kind }; }
  else if (kind === 'append-member') { if (node.kind !== 'object') throw Error(structureText.object); action = { kind, keyToken: '""', valueToken: 'null' }; }
  else if (kind === 'move-member') { if (node.kind !== 'object') throw Error(moveText.object); if (!node.members.length) throw Error(moveText.empty); action = { kind, fromText: '1', toText: '1' }; }
  else { if (node.kind !== 'array') throw Error(structureText.array); if (kind === 'move-element' && !node.elements.length) throw Error(structureText.empty); action = kind === 'insert-element' ? { kind, indexText: String(node.elements.length), valueToken: 'null' } : { kind, fromText: '0', toText: '0' }; }
  return Object.freeze({ source, base, action: Object.freeze(action) });
}
/** 非法JSON或位置原文可保留，超预算整次拒绝；旧事件不能切换结构操作种类。 */
export function changeSqliteJsonFieldInput(input: SqliteJsonFieldInput, change: string | RecordStructureAction): SqliteJsonFieldInput {
  if (typeof change === 'string') { if (input.action) throw Error(structureText.kind); return Object.freeze({ ...input, base: Object.freeze({ ...input.base, value: changeJsonNodeInput(input.base.value, change) }) }); }
  if (change.kind !== input.action?.kind) throw Error(structureText.kind);
  let units = 0, bytes = 0;
  for (const [key, value] of Object.entries(change)) if (key !== 'kind') { units += value.length; const size = boundedUtf8Bytes(value, jsonLexicalLimits.sourceBytes - bytes); if (units > jsonLexicalLimits.sourceUnits || size === undefined) throw Error(structureText.limited); bytes += size; }
  return Object.freeze({ ...input, action: Object.freeze({ ...change }) });
}
/** 数组从0开始，对象成员从1开始；禁止指数、小数、空白或不安全整数归一化。 */
function position(value: string, member = false): number {
  if (value.length > 16 || !(member ? /^[1-9]\d*$/ : /^(?:0|[1-9]\d*)$/).test(value) || !Number.isSafeInteger(Number(value))) throw Error(member ? moveText.position : structureText.index);
  return Number(value) - (member ? 1 : 0);
}
/** 复用原词法跨度修改，并再次核准确字段及原文；完整合并通过后才产生一个TEXT候选。 */
export function applySqliteJsonFieldInput(input: SqliteJsonFieldInput, current: SqliteOriginalValue | undefined): SqliteOriginalValue {
  if (current !== input.source || current?.kind !== 'text' || current.value !== input.base.value.document.text) throw Error(text.stale);
  const value = input.base.value, action = input.action;
  const document = !action ? applyJsonNodeInput(value, value.document) : action.kind === 'move-member' ? moveJsonObjectMember(value, value.document, position(action.fromText, true), position(action.toText, true)) : applyJsonStructureAction(value, value.document,
    action.kind === 'insert-element' ? { kind: action.kind, index: position(action.indexText), valueToken: action.valueToken } : action.kind === 'move-element' ? { kind: action.kind, from: position(action.fromText), to: position(action.toText) } : action);
  const result = sqliteEditValueSchema.safeParse({ kind: 'text', value: document.text }); if (!result.success) throw Error(text.limited); return result.data;
}
