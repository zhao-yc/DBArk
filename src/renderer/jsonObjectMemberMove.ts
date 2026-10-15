import { boundedUtf8Bytes, jsonLexicalLimits, lexicalNodeAtPath, lexicalToken, type ReadyLexicalDocument } from './jsonLexicalTree';
import { applyJsonNodeInput, type JsonNodeInput } from './jsonNodeInput';
import { objectMemberMoveZh as text } from './locales/objectMemberMove.zh-CN';

/** 使用原对象节点和原文成员序号；不按名称查找，不解析为JavaScript对象后重新枚举。 */
export function moveJsonObjectMember(selection: JsonNodeInput, current: ReadyLexicalDocument, from: number, to: number): ReadyLexicalDocument {
  if (current !== selection.document || lexicalNodeAtPath(current, { document: current, segments: selection.segments }) !== selection.node || lexicalToken(current, selection.node) !== selection.initialToken) throw Error(text.changed);
  const node = selection.node; if (node.kind !== 'object') throw Error(text.object);
  if (!node.members.length) throw Error(text.empty);
  if (![from, to].every(index => Number.isSafeInteger(index) && index >= 0 && index < node.members.length)) throw Error(text.range);
  if (from === to) return current;
  // 完整成员跨度包括原始键token、冒号及其空白和值token；不扫描字符串中的冒号或逗号。
  const spans = node.members.map(member => ({ start: member.keySpan.start, end: current.nodes[member.valueNode].end }));
  const order = [...spans], moved = order.splice(from, 1)[0]; order.splice(to, 0, moved);
  const parts = [current.text.slice(node.start, spans[0].start)];
  spans.forEach((span, index) => {
    if (index) parts.push(current.text.slice(spans[index - 1].end, span.start));
    parts.push(current.text.slice(order[index].start, order[index].end));
  });
  parts.push(current.text.slice(spans.at(-1)!.end, node.end));
  // 分隔边界均在JSON token外，先累计UTF-16/UTF-8，不能先分配超预算完整候选。
  let units = 0, bytes = 0;
  for (const part of parts) {
    units += part.length; if (units > jsonLexicalLimits.sourceUnits) throw Error(text.limited);
    const size = boundedUtf8Bytes(part, jsonLexicalLimits.sourceBytes - bytes); if (size === undefined) throw Error(text.limited); bytes += size;
  }
  // 复用节点替换的全字段拼接、身份及完整词法预算；对象外原文不随移动改变。
  return applyJsonNodeInput({ ...selection, text: parts.join('') }, current);
}
