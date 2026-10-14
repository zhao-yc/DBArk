/** 只读候选：范围使用 UTF-16 偏移；任何数字都不转换为 JavaScript Number。 */
export interface TextSpan { readonly start: number; readonly end: number }
export interface LexicalMember { readonly memberIndex: number; readonly key: string; readonly keySpan: TextSpan; readonly valueNode: number }
export type LexicalNode = TextSpan & (
  | { readonly kind: 'object'; readonly members: readonly LexicalMember[] }
  | { readonly kind: 'array'; readonly elements: readonly number[] }
  | { readonly kind: 'number' | 'string' | 'boolean' | 'null' }
);
export interface JsonLexicalLimits { sourceUnits: number; sourceBytes: number; depth: number; nodes: number; containerItems: number; stringUnits: number; numberUnits: number }
export const jsonLexicalLimits: Readonly<JsonLexicalLimits> = Object.freeze({ sourceUnits: 262_144, sourceBytes: 262_144, depth: 64, nodes: 8192, containerItems: 2048, stringUnits: 65_536, numberUnits: 4096 });
export type ReadyLexicalDocument = Readonly<{ status: 'ready'; text: string; sourceBytes: number; nodes: readonly LexicalNode[]; root: number }>;
export type LexicalDocument = ReadyLexicalDocument | Readonly<{ status: 'invalid' | 'limited'; text: string; offset: number; reason: string }>;
export type LexicalPathSegment = Readonly<{ kind: 'member'; memberIndex: number; key: string } | { kind: 'element'; index: number }>;

/** 逐代码单元计 UTF-8 替代编码字节，不分配 TextEncoder 大缓冲，不改变孤立 surrogate。 */
export function boundedUtf8Bytes(text: string, maximum: number): number | undefined {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes++;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) { bytes += 4; i++; }
    else bytes += 3;
    if (bytes > maximum) return undefined;
  }
  return bytes;
}

/** 测试与调用方只能降低预算，不能通过参数放宽产品候选的硬限额。 */
function limitsOf(overrides: Partial<JsonLexicalLimits>): JsonLexicalLimits {
  const limits = { ...jsonLexicalLimits };
  for (const key of Object.keys(overrides)) {
    if (!Object.hasOwn(limits, key)) throw new Error('未知 JSON 词法预算');
    const descriptor = Object.getOwnPropertyDescriptor(overrides, key)!;
    if (!('value' in descriptor)) throw new Error('JSON 词法预算不能含访问器');
    const value: unknown = descriptor.value;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > limits[key as keyof JsonLexicalLimits]) throw new Error('JSON 词法预算只能降低');
    limits[key as keyof JsonLexicalLimits] = value;
  }
  return limits;
}

class ReadFailure extends Error { constructor(readonly status: 'invalid' | 'limited', readonly offset: number, reason: string) { super(reason); } }

/** 在先验深度上限内递归读取，完整尾部通过后才发布冻结树，错误不返回任何部分节点。 */
export function parseJsonLexicalTree(text: string, overrides: Partial<JsonLexicalLimits> = {}): LexicalDocument { return parseWithLimits(text, limitsOf(overrides)); }

/** 整行输入格式使用独立固定预算，不能通过参数放宽单JSON字段的硬限额。 */
export const recordInputLexicalLimits: Readonly<JsonLexicalLimits> = Object.freeze({ sourceUnits: 2_097_152, sourceBytes: 2_097_152, depth: 16, nodes: 32768, containerItems: 4096, stringUnits: 2_097_152, numberUnits: 16 });
/** 仅供显式整行输入格式的完整词法预检；输出仍不丢重复成员或数字原文。 */
export function parseRecordInputDocumentTree(text: string): LexicalDocument { return parseWithLimits(text, recordInputLexicalLimits); }

/** 两个公开入口各自选择固定策略，扫描内核不接收未验证的用户预算覆盖。 */
function parseWithLimits(text: string, limits: Readonly<JsonLexicalLimits>): LexicalDocument {
  if (typeof text !== 'string') throw new Error('JSON 词法树只接受原始字符串');
  if (text.length > limits.sourceUnits) return Object.freeze({ status: 'limited', text, offset: 0, reason: 'JSON 原文超过 UTF-16 预算' });
  const sourceBytes = boundedUtf8Bytes(text, limits.sourceBytes);
  if (sourceBytes === undefined) return Object.freeze({ status: 'limited', text, offset: 0, reason: 'JSON 原文超过 UTF-8 预算' });
  let cursor = 0;
  const nodes: LexicalNode[] = [];
  const invalid = (reason: string): never => { throw new ReadFailure('invalid', cursor, reason); };
  const limited = (reason: string): never => { throw new ReadFailure('limited', cursor, reason); };
  const space = () => { while (cursor < text.length && (text[cursor] === ' ' || text[cursor] === '\t' || text[cursor] === '\r' || text[cursor] === '\n')) cursor++; };
  const digit = () => text[cursor] >= '0' && text[cursor] <= '9';

  /** 只定位并校验一个字符串 token；容器永不传入 JSON.parse。 */
  function stringSpan(): TextSpan {
    const start = cursor++;
    while (cursor < text.length) {
      if (cursor - start - 1 > limits.stringUnits) limited('JSON 字符串 token 超过预算');
      const code = text.charCodeAt(cursor++);
      if (code === 34) return Object.freeze({ start, end: cursor });
      if (code < 32) invalid('JSON 字符串含未转义控制字符');
      if (code === 92) {
        const escape = text[cursor++];
        if (escape === 'u') {
          for (let i = 0; i < 4; i++) { const code = text.charCodeAt(cursor++); if (!(code >= 48 && code <= 57 || code >= 65 && code <= 70 || code >= 97 && code <= 102)) invalid('JSON Unicode 转义不完整或非法'); }
        } else if (!['"', '\\', '/', 'b', 'f', 'n', 'r', 't'].includes(escape)) invalid('JSON 字符串含非法转义');
      }
    }
    return invalid('JSON 字符串没有结束引号');
  }

  /** 成员和元素使用有序数组；重复成员没有任何字典覆盖机会。 */
  function value(depth: number): number {
    if (depth > limits.depth) limited('JSON 深度超过预算');
    if (nodes.length >= limits.nodes) limited('JSON 节点数超过预算');
    space(); const start = cursor; const id = nodes.length;
    nodes.push({ kind: 'null', start, end: start });
    const first = text[cursor];
    if (first === '{' || first === '[') {
      const object = first === '{'; cursor++; space();
      const members: LexicalMember[] = []; const elements: number[] = []; const end = object ? '}' : ']';
      if (text[cursor] !== end) {
        for (;;) {
          if ((object ? members.length : elements.length) >= limits.containerItems) limited('JSON 容器成员数超过预算');
          if (object) {
            if (text[cursor] !== '"') invalid('JSON 对象成员名必须是字符串');
            const keySpan = stringSpan();
            const key = JSON.parse(text.slice(keySpan.start, keySpan.end)) as string;
            space(); if (text[cursor++] !== ':') invalid('JSON 对象成员缺少冒号');
            const valueNode = value(depth + 1);
            members.push(Object.freeze({ memberIndex: members.length, key, keySpan, valueNode }));
          } else elements.push(value(depth + 1));
          space(); if (text[cursor] === end) break;
          if (text[cursor++] !== ',') invalid('JSON 容器缺少逗号或结束符');
          space();
        }
      }
      cursor++;
      nodes[id] = Object.freeze(object ? { kind: 'object', start, end: cursor, members: Object.freeze(members) } : { kind: 'array', start, end: cursor, elements: Object.freeze(elements) });
    } else if (first === '"') {
      const span = stringSpan(); nodes[id] = Object.freeze({ kind: 'string', ...span });
    } else if (first === '-' || digit()) {
      if (first === '-') cursor++;
      if (text[cursor] === '0') cursor++;
      else { if (!(text[cursor] >= '1' && text[cursor] <= '9')) invalid('JSON 数字缺少整数部分'); while (digit()) cursor++; }
      if (text[cursor] === '.') { cursor++; if (!digit()) invalid('JSON 小数部分不能为空'); while (digit()) cursor++; }
      if (text[cursor] === 'e' || text[cursor] === 'E') { cursor++; if (text[cursor] === '+' || text[cursor] === '-') cursor++; if (!digit()) invalid('JSON 指数不能为空'); while (digit()) cursor++; }
      if (cursor - start > limits.numberUnits) limited('JSON 数字 token 超过预算');
      nodes[id] = Object.freeze({ kind: 'number', start, end: cursor });
    } else {
      const literal = first === 't' ? 'true' : first === 'f' ? 'false' : first === 'n' ? 'null' : '';
      if (!literal || text.slice(cursor, cursor + literal.length) !== literal) invalid('JSON 值非法或缺失');
      cursor += literal.length; nodes[id] = Object.freeze({ kind: literal === 'null' ? 'null' : 'boolean', start, end: cursor });
    }
    return id;
  }
  try {
    const root = value(1); space(); if (cursor !== text.length) invalid('JSON 根值后存在多余内容');
    return Object.freeze({ status: 'ready', text, sourceBytes, nodes: Object.freeze(nodes), root });
  } catch (error) {
    if (!(error instanceof ReadFailure)) throw error;
    return Object.freeze({ status: error.status, text, offset: Math.min(cursor, text.length), reason: error.message });
  }
}

/** 路径必须绑定同一文档引用；对象成员序号决定位置，显示键仅作交叉核对。 */
export function lexicalNodeAtPath(document: ReadyLexicalDocument, path: { document: ReadyLexicalDocument; segments: readonly LexicalPathSegment[] }): LexicalNode | undefined {
  if (path.document !== document || path.segments.length > jsonLexicalLimits.depth) return undefined;
  let node = document.nodes[document.root];
  for (const segment of path.segments) {
    if (segment.kind === 'member') {
      if (node.kind !== 'object' || !Number.isInteger(segment.memberIndex) || segment.memberIndex < 0) return undefined;
      const member = node.members[segment.memberIndex]; if (!member || member.key !== segment.key) return undefined;
      node = document.nodes[member.valueNode];
    } else {
      if (node.kind !== 'array' || !Number.isInteger(segment.index) || segment.index < 0 || segment.index >= node.elements.length) return undefined;
      node = document.nodes[node.elements[segment.index]];
    }
  }
  return node;
}

/** 原文切片才是数字/字符串的权威词法，不格式化为新的 JSON。 */
export function lexicalToken(document: ReadyLexicalDocument, node: LexicalNode): string {
  if (!document.nodes.includes(node)) throw new Error('节点不属于当前 JSON 文档');
  return document.text.slice(node.start, node.end);
}
