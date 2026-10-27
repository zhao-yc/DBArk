import { routineInvocationZh as text } from './routineInvocation.zh-CN';

export const routineInvocationLimits = {
  parameters: 200, definitionBytes: 1024 * 1024, metadataBytes: 2 * 1024 * 1024,
  typeBytes: 65536, nameCharacters: 64, nameBytes: 256, connectionIdBytes: 256,
  sqlBytes: 128 * 1024, sqlModeBytes: 8192, tokens: 200000, nesting: 32,
} as const;
export interface RoutineInvocationTarget { connectionId: string; database: string; name: string; kind: 'procedure' | 'function'; }
export interface RoutineInvocationParameter { ordinal: number; name: string; mode: 'IN' | 'OUT' | 'INOUT'; type: string; }
export interface RoutineInvocationMetadata extends RoutineInvocationTarget { parameters: RoutineInvocationParameter[]; returnType?: string; fingerprint: string; }
export interface RoutineCreateSignature { parameters: RoutineInvocationParameter[]; returnType?: string; }
export interface RoutineInvocationArgument { ordinal: number; name: string; mode: 'IN' | 'INOUT'; type: string; placeholder: string; }
export interface RoutineInvocationOutput { ordinal: number; name: string; variable: string; column: string; }
export interface RoutineInvocationDraft { kind: RoutineInvocationTarget['kind']; nonce: string; sql: string; arguments: RoutineInvocationArgument[]; outputs: RoutineInvocationOutput[]; }

const invalid = (): never => { throw Error(text.invalid); };
const unavailable = (): never => { throw Error(text.definitionUnavailable); };
const budget = (): never => { throw Error(text.budget); };
type Size = { bytes: number };
/** 先测量有界UTF-8，再克隆字段；不把孤立代理项替换成不同的名称或类型。 */
function string(value: unknown, maximum: number, size?: Size): string {
  if (typeof value !== 'string' || !value.length || value.includes('\0')) return invalid();
  if (value.length > maximum) return budget();
  let bytes = 0;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) { const next = value.charCodeAt(++index); if (!(next >= 0xdc00 && next <= 0xdfff)) return invalid(); bytes += 4; }
    else if (code >= 0xdc00 && code <= 0xdfff) return invalid();
    else bytes += code < 128 ? 1 : code < 2048 ? 2 : 3;
    if (bytes > maximum) return budget();
  }
  if (size && (size.bytes += bytes) > routineInvocationLimits.metadataBytes) return budget();
  return value;
}
/** 仅取普通自有数据属性，不执行getter、toJSON或自定义迭代器。 */
function own(value: object, key: string): unknown { const entry = Object.getOwnPropertyDescriptor(value, key); if (!entry || !entry.enumerable || !('value' in entry)) return invalid(); return entry.value; }
function record(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return invalid();
  const keys = Reflect.ownKeys(value), allowed = new Set([...required, ...optional]);
  if (keys.length < required.length || keys.length > allowed.size) return invalid();
  for (const key of keys) { if (typeof key !== 'string' || !allowed.has(key)) return invalid(); own(value, key); }
  for (const key of required) own(value, key);
  return value as Record<string, unknown>;
}
function name(value: unknown, size?: Size): string { const result = string(value, routineInvocationLimits.nameBytes, size); if (result.length > routineInvocationLimits.nameCharacters) return budget(); return result; }
/** 输入目标与元数据都绑定已保存连接ID，永远不接受任意主机或连接凭据。 */
export function parseRoutineInvocationTarget(value: unknown): RoutineInvocationTarget {
  const source = record(value, ['connectionId', 'database', 'name', 'kind']);
  const kind = own(source, 'kind'); if (kind !== 'procedure' && kind !== 'function') return invalid();
  return { connectionId: string(own(source, 'connectionId'), routineInvocationLimits.connectionIdBytes), database: name(own(source, 'database')), name: name(own(source, 'name')), kind };
}
/** 完整参数按ordinal连续排列；函数返回值独立存放，不混入ordinal=0的调用参数。 */
export function parseRoutineInvocationMetadata(value: unknown): RoutineInvocationMetadata {
  const source = record(value, ['connectionId', 'database', 'name', 'kind', 'parameters', 'fingerprint'], ['returnType']);
  const target = parseRoutineInvocationTarget({ connectionId: own(source, 'connectionId'), database: own(source, 'database'), name: own(source, 'name'), kind: own(source, 'kind') });
  const fingerprint = own(source, 'fingerprint'); if (typeof fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(fingerprint)) return invalid();
  const supplied = own(source, 'parameters'); if (!Array.isArray(supplied) || Object.getPrototypeOf(supplied) !== Array.prototype) return invalid();
  const count = Object.getOwnPropertyDescriptor(supplied, 'length')?.value;
  if (!Number.isSafeInteger(count) || count < 0) return invalid(); if (count > routineInvocationLimits.parameters) return budget();
  if (Reflect.ownKeys(supplied).length !== count + 1) return invalid();
  const size = { bytes: 512 }, parameters: RoutineInvocationParameter[] = [], names = new Set<string>();
  for (let index = 0; index < count; index++) {
    const entry = record(own(supplied, String(index)), ['ordinal', 'name', 'mode', 'type']);
    const ordinal = own(entry, 'ordinal'), mode = own(entry, 'mode'), parameterName = name(own(entry, 'name'), size);
    if (typeof ordinal !== 'number' || ordinal !== index + 1 || (mode !== 'IN' && mode !== 'OUT' && mode !== 'INOUT') || target.kind === 'function' && mode !== 'IN' || names.has(parameterName.toLowerCase())) return invalid();
    names.add(parameterName.toLowerCase()); size.bytes += 256;
    const type = string(own(entry, 'type'), routineInvocationLimits.typeBytes, size); if (!type.trim()) return invalid();
    parameters.push({ ordinal, name: parameterName, mode, type });
  }
  let returnType: string | undefined;
  if (target.kind === 'function') { returnType = string(own(source, 'returnType'), routineInvocationLimits.typeBytes, size); if (!returnType.trim()) return invalid(); }
  else if (Object.hasOwn(source, 'returnType')) return invalid();
  return { ...target, parameters, ...(returnType === undefined ? {} : { returnType }), fingerprint };
}

type Token = { kind: 'word' | 'identifier' | 'string' | 'symbol'; value: string; start: number; end: number };
interface Mode { ansi: boolean; noBackslash: boolean; realAsFloat: boolean; }
/** 只按例程创建时保存的模式解释引号；Oracle例程语法不冒充MySQL参数语法。 */
function mode(sqlMode: string): Mode {
  if (typeof sqlMode !== 'string' || sqlMode.length > routineInvocationLimits.sqlModeBytes || !/^[A-Za-z0-9_,\s]*$/.test(sqlMode)) return unavailable();
  const values = new Set(sqlMode.split(',').map(value => value.trim().toUpperCase())); if (values.has('ORACLE')) return unavailable();
  return { ansi: values.has('ANSI_QUOTES') || values.has('ANSI'), noBackslash: values.has('NO_BACKSLASH_ESCAPES'), realAsFloat: values.has('REAL_AS_FLOAT') || values.has('ANSI') };
}
type TokenAt = (index: number) => Token | undefined;
/** 按需读取头部token；确定正文首token后不再扫描，不能用SQL正文根词白名单缩小合法例程。 */
function lexer(source: string, saved: Mode): TokenAt {
  const cache: Token[] = []; let position = 0, ended = false;
  const nextToken = (): Token | undefined => {
    while (position < source.length) {
      const start = position, character = source[position], next = source[position + 1];
      if (/\s/.test(character)) { position++; continue; }
      if (character === '#' || character === '-' && next === '-' && (position + 2 === source.length || source.charCodeAt(position + 2) <= 32)) { const end = source.indexOf('\n', position); position = end < 0 ? source.length : end + 1; continue; }
      if (character === '/' && next === '*') { if (source[position + 2] === '!' || /^m!/i.test(source.slice(position + 2, position + 4))) return unavailable(); const end = source.indexOf('*/', position + 2); if (end < 0) return unavailable(); position = end + 2; continue; }
      if (character === "'" || character === '"' || character === '`') {
        const identifier = character === '`' || character === '"' && saved.ansi; let value = '', closed = false; position++;
        while (position < source.length) {
          const current = source[position++];
          if (current === character) { if (source[position] === character) { value += character; position++; } else { closed = true; break; } }
          else if (current === '\\' && !identifier && !saved.noBackslash) {
            if (position >= source.length) return unavailable(); const escaped = source[position++], escapes: Record<string, string> = { '0': '\0', b: '\b', n: '\n', r: '\r', t: '\t', Z: '\x1a' };
            value += escaped === '%' || escaped === '_' ? '\\' + escaped : escapes[escaped] ?? escaped;
          } else value += current;
        }
        if (!closed) return unavailable(); return { kind: identifier ? 'identifier' : 'string', value, start, end: position };
      }
      if (/[A-Za-z0-9_$\u0080-\uffff]/.test(character)) { position++; while (position < source.length && /[A-Za-z0-9_$\u0080-\uffff]/.test(source[position])) position++; return { kind: 'word', value: source.slice(start, position), start, end: position }; }
      position++; return { kind: 'symbol', value: character, start, end: position };
    }
    return undefined;
  };
  return index => {
    while (cache.length <= index && !ended) {
      const next = nextToken(); if (!next) { ended = true; break; }
      if (cache.length >= routineInvocationLimits.tokens) return budget(); cache.push(next);
    }
    return cache[index];
  };
}
const keyword = (token: Token | undefined, value: string) => token?.kind === 'word' && token.value.toUpperCase() === value;
function identifier(token: Token | undefined): string { if (!token || token.kind !== 'word' && token.kind !== 'identifier' || token.kind === 'word' && /^\d+$/.test(token.value)) return unavailable(); return name(token.value); }
const aliases: Record<string, string> = { INTEGER: 'INT', INT1: 'TINYINT', INT2: 'SMALLINT', INT3: 'MEDIUMINT', INT4: 'INT', INT8: 'BIGINT', NUMERIC: 'DECIMAL', DEC: 'DECIMAL', FIXED: 'DECIMAL', BOOL: 'TINYINT', BOOLEAN: 'TINYINT', NCHAR: 'CHAR', NVARCHAR: 'VARCHAR' };
const bases = new Set('TINYINT SMALLINT MEDIUMINT INT INTEGER BIGINT INT1 INT2 INT3 INT4 INT8 BOOL BOOLEAN DECIMAL DEC NUMERIC FIXED FLOAT DOUBLE REAL BIT DATE DATETIME TIMESTAMP TIME YEAR CHAR CHARACTER VARCHAR NCHAR NVARCHAR NATIONAL BINARY VARBINARY TINYBLOB BLOB MEDIUMBLOB LONGBLOB TINYTEXT TEXT MEDIUMTEXT LONGTEXT ENUM SET JSON GEOMETRY POINT LINESTRING POLYGON MULTIPOINT MULTILINESTRING MULTIPOLYGON GEOMETRYCOLLECTION UUID INET4 INET6 VECTOR'.split(' '));
/** 类型只用于核验/展示，绝不进入生成SQL；别名和字符集修饰按结构规范化。 */
function typeTokens(input: TokenAt, start: number, saved: Mode, end = Infinity): { end: number; normalized: string } {
  const at: TokenAt = index => index < end ? input(index) : undefined;
  let position = start, base = at(position)?.value.toUpperCase(); if (typeof base !== 'string' || at(position)?.kind !== 'word' || !bases.has(base)) return unavailable(); position++;
  if (base === 'NATIONAL') { if (!keyword(at(position), 'CHAR') && !keyword(at(position), 'CHARACTER') && !keyword(at(position), 'VARCHAR')) return unavailable(); base = at(position++)!.value.toUpperCase(); }
  if (base === 'CHARACTER') { base = keyword(at(position), 'VARYING') ? (position++, 'VARCHAR') : 'CHAR'; }
  if ((base === 'DOUBLE' || base === 'REAL') && keyword(at(position), 'PRECISION')) position++;
  if (base === 'REAL') base = saved.realAsFloat ? 'FLOAT' : 'DOUBLE';
  base = aliases[base] ?? base;
  let arguments_: string[] = [];
  if (at(position)?.kind === 'symbol' && at(position)?.value === '(') {
    position++; let expected = true;
    while (at(position) && !(at(position)!.kind === 'symbol' && at(position)!.value === ')')) {
      const token = at(position++)!;
      if (expected) {
        if (base === 'ENUM' || base === 'SET') { if (token.kind !== 'string') return unavailable(); arguments_.push(JSON.stringify(token.value)); }
        else { if (token.kind !== 'word' || !/^\d{1,6}$/.test(token.value)) return unavailable(); arguments_.push(String(Number(token.value))); }
      } else if (token.value !== ',' || token.kind !== 'symbol') return unavailable();
      expected = !expected;
    }
    if (at(position)?.kind !== 'symbol' || at(position)?.value !== ')' || expected) return unavailable(); position++;
  } else if (base === 'ENUM' || base === 'SET' || base === 'VARCHAR' || base === 'VARBINARY') return unavailable();
  if (base !== 'ENUM' && base !== 'SET' && arguments_.length > (['DECIMAL', 'FLOAT', 'DOUBLE'].includes(base) ? 2 : 1)) return unavailable();
  // 整数显示宽度不改变调用能力；零填充隐含unsigned，DECIMAL/CHAR的默认宽度按服务器别名归一。
  if (['TINYINT', 'SMALLINT', 'MEDIUMINT', 'INT', 'BIGINT'].includes(base)) arguments_ = [];
  if (base === 'FLOAT' && arguments_.length === 1) { if (Number(arguments_[0]) > 53) return unavailable(); if (Number(arguments_[0]) > 24) base = 'DOUBLE'; arguments_ = []; }
  if (base === 'DECIMAL') { if (!arguments_.length) arguments_ = ['10', '0']; else if (arguments_.length === 1) arguments_.push('0'); }
  if (['CHAR', 'BINARY', 'BIT'].includes(base) && !arguments_.length) arguments_ = ['1'];
  if (['DATETIME', 'TIMESTAMP', 'TIME'].includes(base) && arguments_.length === 1 && arguments_[0] === '0' || base === 'YEAR' && arguments_.length === 1 && arguments_[0] === '4') arguments_ = [];
  const attributes = new Set<string>();
  while (at(position)) {
    const token = at(position)!;
    if (keyword(token, 'UNSIGNED') || keyword(token, 'SIGNED') || keyword(token, 'ZEROFILL') || keyword(token, 'BINARY') || keyword(token, 'ASCII') || keyword(token, 'UNICODE')) {
      const attribute = token.value.toUpperCase(); if (attributes.has(attribute)) return unavailable(); attributes.add(attribute); position++; continue;
    }
    if (keyword(token, 'CHARACTER') && keyword(at(position + 1), 'SET') || keyword(token, 'CHARSET')) { position += keyword(token, 'CHARACTER') ? 2 : 1; identifier(at(position++)); if (attributes.has('CHARSET')) return unavailable(); attributes.add('CHARSET'); continue; }
    if (keyword(token, 'COLLATE')) { position++; identifier(at(position++)); if (attributes.has('COLLATE')) return unavailable(); attributes.add('COLLATE'); continue; }
    break;
  }
  const unsigned = attributes.has('UNSIGNED') || attributes.has('ZEROFILL');
  return { end: position, normalized: base + (arguments_.length ? '(' + arguments_.join(',') + ')' : '') + (unsigned ? ' UNSIGNED' : '') + (attributes.has('ZEROFILL') ? ' ZEROFILL' : '') };
}
/** 比较目录DTD_IDENTIFIER与定义类型；字符集/排序规则由后端原始目录及DDL共同指纹绑定。 */
export function normalizeRoutineParameterType(value: string, sqlMode = ''): string {
  const checked = string(value, routineInvocationLimits.typeBytes), saved = mode(sqlMode), at = lexer(checked, saved), parsed = typeTokens(at, 0, saved);
  if (at(parsed.end)) return unavailable(); return parsed.normalized;
}

/** 仅解析真实CREATE头和保存模式，不从正文/注释猜参数，不接受空权限回包代替定义。 */
export function parseRoutineCreateSignature(ddl: string, sqlMode: string, suppliedTarget: RoutineInvocationTarget): RoutineCreateSignature {
  const target = parseRoutineInvocationTarget(suppliedTarget), source = string(ddl, routineInvocationLimits.definitionBytes), saved = mode(sqlMode), at = lexer(source, saved); let position = 0;
  const take = (value: string) => { if (!keyword(at(position++), value)) return unavailable(); };
  take('CREATE'); if (keyword(at(position), 'OR')) { position++; take('REPLACE'); }
  if (keyword(at(position), 'DEFINER')) {
    position++; if (at(position++)?.value !== '=') return unavailable();
    const definer = at(position++); if (!definer || !['word', 'identifier', 'string'].includes(definer.kind)) return unavailable();
    if (keyword(definer, 'CURRENT_USER')) { if (at(position)?.value === '(') { position++; if (at(position++)?.value !== ')') return unavailable(); } }
    else { if (at(position++)?.value !== '@') return unavailable(); const host = at(position++); if (!host || !['word', 'identifier', 'string'].includes(host.kind)) return unavailable(); }
  }
  take(target.kind === 'procedure' ? 'PROCEDURE' : 'FUNCTION');
  if (keyword(at(position), 'IF')) { position++; take('NOT'); take('EXISTS'); }
  let routineName = identifier(at(position++));
  if (at(position)?.value === '.') { position++; if (routineName !== target.database) return unavailable(); routineName = identifier(at(position++)); }
  if (routineName !== target.name || at(position++)?.value !== '(') return unavailable();
  const parameters: RoutineInvocationParameter[] = []; let segment = position, depth = 1, closed = false;
  const parameter = (end: number) => {
    if (parameters.length >= routineInvocationLimits.parameters) return budget(); let cursor = segment, parameterMode: RoutineInvocationParameter['mode'] = 'IN';
    if (['IN', 'OUT', 'INOUT'].some(value => keyword(at(cursor), value))) parameterMode = at(cursor++)!.value.toUpperCase() as RoutineInvocationParameter['mode'];
    const parameterName = identifier(at(cursor++)); if (target.kind === 'function' && parameterMode !== 'IN' || cursor >= end) return unavailable();
    const parsed = typeTokens(at, cursor, saved, end); if (parsed.end !== end) return unavailable();
    const type = string(source.slice(at(cursor)!.start, at(end - 1)!.end).trim(), routineInvocationLimits.typeBytes);
    parameters.push({ ordinal: parameters.length + 1, name: parameterName, mode: parameterMode, type });
  };
  while (at(position)) {
    const token = at(position)!;
    if (token.kind === 'symbol' && token.value === '(') { if (++depth > routineInvocationLimits.nesting) return budget(); }
    else if (token.kind === 'symbol' && token.value === ')') {
      if (--depth === 0) { if (position > segment) parameter(position); else if (parameters.length) return unavailable(); position++; closed = true; break; }
    } else if (token.kind === 'symbol' && token.value === ',' && depth === 1) { if (position === segment) return unavailable(); parameter(position); segment = position + 1; }
    position++;
  }
  if (!closed) return unavailable();
  let returnType: string | undefined;
  if (target.kind === 'function') { take('RETURNS'); const start = position, parsed = typeTokens(at, start, saved); position = parsed.end; returnType = string(source.slice(at(start)!.start, at(position - 1)!.end).trim(), routineInvocationLimits.typeBytes); }
  // 按需消费标准characteristics；遇到首个正文token即停，不维护SQL语句白名单或读取正文后续。
  while (at(position)) {
    if (keyword(at(position), 'COMMENT')) { position++; if (at(position++)?.kind !== 'string') return unavailable(); }
    else if (keyword(at(position), 'LANGUAGE')) { position++; take('SQL'); }
    else if (keyword(at(position), 'DETERMINISTIC')) position++;
    else if (keyword(at(position), 'NOT')) { position++; take('DETERMINISTIC'); }
    else if (keyword(at(position), 'SQL')) { position++; take('SECURITY'); if (!keyword(at(position), 'DEFINER') && !keyword(at(position), 'INVOKER')) return unavailable(); position++; }
    else if (keyword(at(position), 'CONTAINS') || keyword(at(position), 'NO')) { position++; take('SQL'); }
    else if (keyword(at(position), 'READS') || keyword(at(position), 'MODIFIES')) { position++; take('SQL'); take('DATA'); }
    else break;
  }
  const body = at(position); if (!body || body.kind === 'symbol' && body.value === ';') return unavailable();
  const names = new Set<string>(); for (const entry of parameters) { if (names.has(entry.name.toLowerCase())) return unavailable(); names.add(entry.name.toLowerCase()); }
  return { parameters, ...(returnType === undefined ? {} : { returnType }) };
}

/** 定义与目录必须逐项一致；零参数只在两种来源都完整且同意时成立。 */
export function assertRoutineInvocationMetadata(value: RoutineInvocationMetadata, signature: RoutineCreateSignature, sqlMode = ''): void {
  const metadata = parseRoutineInvocationMetadata(value);
  if (metadata.parameters.length !== signature.parameters.length || (metadata.returnType === undefined) !== (signature.returnType === undefined)) throw Error(text.metadataChanged);
  for (let index = 0; index < metadata.parameters.length; index++) {
    const left = metadata.parameters[index], right = signature.parameters[index];
    if (left.ordinal !== right.ordinal || left.name !== right.name || left.mode !== right.mode || normalizeRoutineParameterType(left.type, sqlMode) !== normalizeRoutineParameterType(right.type, sqlMode)) throw Error(text.metadataChanged);
  }
  if (metadata.returnType !== undefined && normalizeRoutineParameterType(metadata.returnType, sqlMode) !== normalizeRoutineParameterType(signature.returnType!, sqlMode)) throw Error(text.metadataChanged);
}
const quote = (value: string) => '`' + value.replaceAll('`', '``') + '`';
/** 只拼接受引用的标识符及固定ASCII占位符；类型、参数名、正文和参数值均不进入SQL。 */
export function buildRoutineInvocation(value: RoutineInvocationMetadata, options: { nonce?: string } = {}): RoutineInvocationDraft {
  const metadata = parseRoutineInvocationMetadata(value), checked = record(options, [], ['nonce']);
  const nonce = Object.hasOwn(checked, 'nonce') ? own(checked, 'nonce') : typeof globalThis.crypto?.randomUUID === 'function' ? globalThis.crypto.randomUUID().replaceAll('-', '') : invalid();
  if (typeof nonce !== 'string' || !/^[a-f0-9]{32}$/.test(nonce)) return invalid();
  const arguments_: RoutineInvocationArgument[] = [], outputs: RoutineInvocationOutput[] = [], call: string[] = [], initialize: string[] = [];
  for (const parameter of metadata.parameters) {
    const placeholder = ':arg_' + parameter.ordinal;
    if (parameter.mode !== 'OUT') arguments_.push({ ordinal: parameter.ordinal, name: parameter.name, mode: parameter.mode, type: parameter.type, placeholder });
    if (parameter.mode === 'IN') call.push(placeholder);
    else { const variable = '@dbark_call_' + nonce + '_' + parameter.ordinal; outputs.push({ ordinal: parameter.ordinal, name: parameter.name, variable, column: 'out_' + parameter.ordinal }); initialize.push(variable + ' = ' + (parameter.mode === 'OUT' ? 'NULL' : placeholder)); call.push(variable); }
  }
  const routine = quote(metadata.database) + '.' + quote(metadata.name), statements: string[] = [];
  if (metadata.kind === 'function') statements.push('SELECT ' + routine + '(' + call.join(', ') + ') AS `return_value`;');
  else {
    if (initialize.length) statements.push('SET ' + initialize.join(', ') + ';');
    statements.push('CALL ' + routine + '(' + call.join(', ') + ');');
    if (outputs.length) { statements.push('SELECT ' + outputs.map(output => output.variable + ' AS ' + quote(output.column)).join(', ') + ';'); statements.push('SET ' + outputs.map(output => output.variable + ' = NULL').join(', ') + ';'); }
  }
  const sql = statements.join('\n'); string(sql, routineInvocationLimits.sqlBytes);
  return { kind: metadata.kind, nonce, sql, arguments: arguments_, outputs };
}
