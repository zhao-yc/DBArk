import { beginJsonNodeInput, changeJsonNodeInput, applyJsonNodeInput, type JsonNodeInput } from './jsonNodeInput';
import { applyJsonStructureAction } from './jsonStructureInput';
import { moveJsonObjectMember } from './jsonObjectMemberMove';
import { boundedUtf8Bytes, jsonLexicalLimits, lexicalNodeAtPath, type LexicalPathSegment, type ReadyLexicalDocument } from './jsonLexicalTree';
import type { RecordStructureAction, RecordStructureKind } from './recordJsonStructureInput';
import { recordJsonStructureInputZh as structureText } from './locales/recordJsonStructureInput.zh-CN';
import { objectMemberMoveZh as moveText } from './locales/objectMemberMove.zh-CN';

export interface RecordJsonFieldInput {
  readonly base: { readonly session: object; readonly columnName: string; readonly value: JsonNodeInput };
  readonly action?: RecordStructureAction;
}
/** 在已核对的完整词法原文上打开一个节点或结构输入。 */
export function beginRecordJsonFieldInput(columnName: string, document: ReadyLexicalDocument, segments: readonly LexicalPathSegment[], kind?: RecordStructureKind): RecordJsonFieldInput {
  const value = beginJsonNodeInput(document, segments);
  const base = Object.freeze({ session: {}, columnName, value });
  if (!kind) return Object.freeze({ base });
  const node = value.node, last = segments.at(-1);
  let action: RecordStructureAction;
  if (kind === 'rename') {
    if (!last) throw Error(structureText.root);
    if (last.kind !== 'member') throw Error(structureText.member);
    const parent = lexicalNodeAtPath(document, { document, segments: segments.slice(0, -1) });
    if (parent?.kind !== 'object') throw Error(structureText.member);
    const span = parent.members[last.memberIndex].keySpan;
    action = { kind, keyToken: document.text.slice(span.start, span.end) };
  } else if (kind === 'remove') {
    if (!last) throw Error(structureText.root);
    action = { kind };
  } else if (kind === 'append-member') {
    if (node.kind !== 'object') throw Error(structureText.object);
    action = { kind, keyToken: '""', valueToken: 'null' };
  } else if (kind === 'move-member') {
    if (node.kind !== 'object') throw Error(moveText.object);
    if (!node.members.length) throw Error(moveText.empty);
    action = { kind, fromText: '1', toText: '1' };
  } else {
    if (node.kind !== 'array') throw Error(structureText.array);
    if (kind === 'move-element' && !node.elements.length) throw Error(structureText.empty);
    action = kind === 'insert-element' ? { kind, indexText: String(node.elements.length), valueToken: 'null' }
      : { kind, fromText: '0', toText: '0' };
  }
  return Object.freeze({ base, action: Object.freeze(action) });
}
/** 非法JSON或位置原文可保留，超预算整次拒绝；旧事件不能切换结构操作种类。 */
export function changeRecordJsonFieldInput(input: RecordJsonFieldInput, change: string | RecordStructureAction): RecordJsonFieldInput {
  if (typeof change === 'string') {
    if (input.action) throw Error(structureText.kind);
    return Object.freeze({ ...input, base: Object.freeze({ ...input.base, value: changeJsonNodeInput(input.base.value, change) }) });
  }
  if (change.kind !== input.action?.kind) throw Error(structureText.kind);
  let units = 0, bytes = 0;
  for (const [key, value] of Object.entries(change)) {
    if (key === 'kind') continue;
    units += value.length;
    const size = boundedUtf8Bytes(value, jsonLexicalLimits.sourceBytes - bytes);
    if (units > jsonLexicalLimits.sourceUnits || size === undefined) throw Error(structureText.limited);
    bytes += size;
  }
  return Object.freeze({ ...input, action: Object.freeze({ ...change }) });
}
/** 数组从0开始，对象成员从1开始；禁止指数、小数、空白或不安全整数归一化。 */
function position(value: string, member = false): number {
  if (value.length > 16 || !(member ? /^[1-9]\d*$/ : /^(?:0|[1-9]\d*)$/).test(value) || !Number.isSafeInteger(Number(value))) throw Error(member ? moveText.position : structureText.index);
  return Number(value) - (member ? 1 : 0);
}
/** 只生成完整的新词法文档，各驱动继续负责原字段和写入预算。 */
export function applyRecordJsonFieldInput(input: RecordJsonFieldInput): ReadyLexicalDocument {
  const { action, base: { value } } = input;
  if (!action) return applyJsonNodeInput(value, value.document);
  if (action.kind === 'move-member') return moveJsonObjectMember(value, value.document, position(action.fromText, true), position(action.toText, true));
  const resolved = action.kind === 'insert-element' ? { kind: action.kind, index: position(action.indexText), valueToken: action.valueToken }
    : action.kind === 'move-element' ? { kind: action.kind, from: position(action.fromText), to: position(action.toText) } : action;
  return applyJsonStructureAction(value, value.document, resolved);
}
