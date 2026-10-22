import { createHash } from 'node:crypto';
import { types } from 'node:util';
import type { TableDefinitionContext } from '../shared/tableColumnPatches';
import { tableDefinitionTokens, type TableDefinitionToken as Token } from './tableColumnDefinition';
import { qualified } from './sql';
import { structureTaskQuery, type StructureTaskContext } from './structureDefinition';

export interface RenameViewReference { database: string; table: string; }
export interface RenameViewDefinition extends RenameViewReference { definition: string; charset: string; collation: string; }
export const renameViewLimits = { views: 4096, page: 128, definitionBytes: 256 * 1024, bytes: 8 * 1024 * 1024, depth: 64, references: 32768 } as const;
const literal = (value: string) => `CONVERT(X'${Buffer.from(value).toString('hex')}' USING utf8mb4)`;
const key = (value: RenameViewReference) => JSON.stringify([value.database, value.table]);
const word = (token: Token | undefined, value?: string) => token?.kind === 'word' && (value === undefined || token.value.toUpperCase() === value);
const symbol = (token: Token | undefined, value: string) => token?.kind === 'symbol' && token.value === value;
const named = (token: Token | undefined) => token?.kind === 'word' || token?.kind === 'identifier';
const clauses = new Set(['WHERE', 'GROUP', 'HAVING', 'ORDER', 'LIMIT', 'PROCEDURE', 'INTO', 'FOR', 'LOCK', 'WINDOW', 'QUALIFY', 'UNION', 'EXCEPT', 'INTERSECT']);
const joinWords = new Set(['JOIN', 'INNER', 'CROSS', 'LEFT', 'RIGHT', 'NATURAL', 'STRAIGHT_JOIN']);

/** 只解析服务器已接受的SELECT关系语法；表达式中的列、别名和文字不充当表名，未知关系语法拒绝证明。 */
class ViewReferences {
  private readonly pairs = new Map<number, number>();
  private readonly refs = new Map<string, RenameViewReference>();
  constructor(private readonly tokens: Token[], private readonly database: string) {
    const stack: number[] = [];
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].kind === 'executable' || tokens[i].value === ';' && tokens[i].kind === 'symbol') throw Error('视图含不受控可执行内容或语句分隔符');
      if (symbol(tokens[i], '(') && tokens[i].kind === 'symbol') { if (stack.length >= renameViewLimits.depth) throw Error('视图嵌套超过证明预算'); stack.push(i); }
      if (symbol(tokens[i], ')') && tokens[i].kind === 'symbol') { const start = stack.pop(); if (start === undefined) throw Error('视图括号不完整'); this.pairs.set(start, i); }
    }
    if (stack.length) throw Error('视图括号不完整');
  }
  /** 只剥覆盖整个候选范围的括号；“((SELECT...) / 2)”仍是表达式而非整段子查询。 */
  private queryLike(start: number, end: number): boolean {
    while (symbol(this.tokens[start], '(') && this.pairs.get(start) === end - 1) { start++; end--; }
    return !!(word(this.tokens[start], 'SELECT') || word(this.tokens[start], 'WITH'));
  }
  /** CTE按声明顺序建立作用域，只有RECURSIVE允许正文引用自身。 */
  private query(start: number, end: number, inherited: ReadonlySet<string>, depth: number): void {
    if (depth > renameViewLimits.depth) throw Error('视图查询嵌套超过证明预算');
    while (symbol(this.tokens[start], '(') && this.pairs.get(start) === end - 1) { start++; end--; }
    let i = start; const scope = new Set(inherited), local = new Set<string>();
    if (word(this.tokens[i], 'WITH')) {
      i++; const recursive = word(this.tokens[i], 'RECURSIVE'); if (recursive) i++;
      while (i < end) {
        const name = this.tokens[i++]; if (!named(name) || local.has(name.value.toLowerCase())) throw Error('视图CTE声明不能唯一证明'); const id = name.value.toLowerCase(); local.add(id);
        if (symbol(this.tokens[i], '(')) { const close = this.pairs.get(i); if (close === undefined || close >= end) throw Error('视图CTE列名不完整'); for (let j = i + 1; j < close; j++) if (!named(this.tokens[j]) && !symbol(this.tokens[j], ',')) throw Error('视图CTE列名语法未知'); i = close + 1; }
        if (!word(this.tokens[i++], 'AS') || !symbol(this.tokens[i], '(')) throw Error('视图CTE正文语法未知');
        const close = this.pairs.get(i); if (close === undefined || close >= end) throw Error('视图CTE正文不完整');
        // 非递归CTE正文只能看到前序CTE；同名真实表及前向同名表不能被尚未生效的CTE遮蔽。
        const bodyScope = new Set(scope); if (recursive) bodyScope.add(id); this.query(i + 1, close, bodyScope, depth + 1); scope.add(id); i = close + 1;
        if (!symbol(this.tokens[i], ',')) break; i++;
      }
    }
    // UNION等集合两侧均独立解析，不能只证明第一个SELECT。
    let part = i;
    for (; i < end; i++) {
      if (symbol(this.tokens[i], '(')) { i = this.pairs.get(i)!; continue; }
      if (word(this.tokens[i]) && ['UNION', 'EXCEPT', 'INTERSECT'].includes(this.tokens[i].value.toUpperCase())) {
        this.select(part, i, scope, depth); i++; if (word(this.tokens[i], 'ALL') || word(this.tokens[i], 'DISTINCT')) i++; part = i; i--;
      }
    }
    this.select(part, end, scope, depth);
  }
  /** 表达式只递归完整子查询；FROM出现在EXTRACT、字符串或注释中不成为关系。 */
  private expression(start: number, end: number, scope: ReadonlySet<string>, depth: number): void {
    if (depth > renameViewLimits.depth) throw Error('视图表达式超过证明预算');
    let first = start, candidateEnd = end; while (symbol(this.tokens[first], '(') && this.pairs.get(first) === candidateEnd - 1) { first++; candidateEnd--; }
    if (word(this.tokens[first], 'TABLE') || word(this.tokens[first], 'VALUES')) throw Error('视图表达式含尚未证明的查询构造');
    for (let i = start; i < end; i++) {
      if (!symbol(this.tokens[i], '(') || this.tokens[i].kind !== 'symbol') continue;
      const close = this.pairs.get(i); if (close === undefined || close >= end) throw Error('视图表达式括号范围未知');
      if (this.queryLike(i + 1, close)) this.query(i + 1, close, scope, depth + 1);
      else this.expression(i + 1, close, scope, depth + 1);
      i = close;
    }
  }
  private select(start: number, end: number, scope: ReadonlySet<string>, depth: number): void {
    while (symbol(this.tokens[start], '(') && this.pairs.get(start) === end - 1) { start++; end--; }
    // 集合查询允许最后一个括号primary后带整体ORDER/LIMIT，尾部不能被并入SELECT正文或静默丢弃。
    if (symbol(this.tokens[start], '(')) {
      const close = this.pairs.get(start); if (close === undefined || close >= end) throw Error('视图括号查询范围未知');
      this.query(start + 1, close, scope, depth + 1); this.queryTail(close + 1, end, scope, depth + 1); return;
    }
    if (!word(this.tokens[start], 'SELECT')) throw Error('视图查询不是已证明的SELECT');
    let from = -1, stop = end;
    for (let i = start + 1; i < end; i++) {
      if (symbol(this.tokens[i], '(')) { i = this.pairs.get(i)!; continue; }
      if (word(this.tokens[i], 'FROM')) { if (from !== -1) throw Error('视图存在未知多重FROM'); from = i; }
      else if (from !== -1 && word(this.tokens[i]) && clauses.has(this.tokens[i].value.toUpperCase())) { stop = i; break; }
      else if (word(this.tokens[i], 'INTO') || word(this.tokens[i], 'PROCEDURE')) throw Error('视图含不支持的SELECT副作用语法');
    }
    this.expression(start + 1, from === -1 ? end : from, scope, depth + 1);
    if (from !== -1) { if (stop === from + 1) throw Error('视图FROM为空'); this.relations(from + 1, stop, scope, depth + 1); this.expression(stop, end, scope, depth + 1); }
    // SELECT后半部若出现另一裸SELECT/FROM，不能当普通表达式忽略。
    for (let i = from === -1 ? start + 1 : stop; i < end; i++) { if (symbol(this.tokens[i], '(')) { i = this.pairs.get(i)!; continue; } if (word(this.tokens[i], 'WITH') && word(this.tokens[i + 1], 'ROLLUP')) { i++; continue; } if (word(this.tokens[i], 'FROM') || word(this.tokens[i], 'SELECT') || word(this.tokens[i], 'WITH') || word(this.tokens[i], 'INTO') || word(this.tokens[i], 'PROCEDURE')) throw Error('视图SELECT尾部语法尚未证明'); }
  }
  /** 括号查询的外层尾部只接受完整ORDER BY和整数LIMIT；排序表达式中的子查询仍递归收集。 */
  private queryTail(start: number, end: number, scope: ReadonlySet<string>, depth: number): void {
    let i = start;
    if (word(this.tokens[i], 'ORDER')) {
      i++; if (!word(this.tokens[i++], 'BY')) throw Error('视图集合排序缺少BY'); const expression = i;
      for (; i < end; i++) {
        if (symbol(this.tokens[i], '(')) { i = this.pairs.get(i)!; continue; }
        if (word(this.tokens[i], 'LIMIT')) break;
        if (word(this.tokens[i]) && ['SELECT', 'WITH', 'FROM', 'WHERE', 'GROUP', 'HAVING', 'ORDER', 'JOIN', 'INTO', 'PROCEDURE', 'FOR', 'LOCK'].includes(this.tokens[i].value.toUpperCase())) throw Error('视图集合排序存在未知语法');
      }
      if (expression === i) throw Error('视图集合排序为空'); this.expression(expression, i, scope, depth + 1);
    }
    if (word(this.tokens[i], 'LIMIT')) {
      const integer = (token: Token | undefined) => token?.kind === 'number' && /^\d+$/.test(token.value);
      i++; if (!integer(this.tokens[i++])) throw Error('视图集合LIMIT未知');
      if (symbol(this.tokens[i], ',') || word(this.tokens[i], 'OFFSET')) { i++; if (!integer(this.tokens[i++])) throw Error('视图集合LIMIT偏移未知'); }
    }
    if (i !== end) throw Error('视图括号查询尾部尚未完整证明');
  }
  private relations(start: number, end: number, scope: ReadonlySet<string>, depth: number): void {
    if (depth > renameViewLimits.depth) throw Error('视图关系嵌套超过证明预算');
    let i = start, needRelation = true;
    while (i < end) {
      if (needRelation) {
        if (symbol(this.tokens[i], '(')) {
          const close = this.pairs.get(i); if (close === undefined || close >= end) throw Error('视图派生关系范围未知');
          if (this.queryLike(i + 1, close)) this.query(i + 1, close, scope, depth + 1); else this.relations(i + 1, close, scope, depth + 1);
          i = close + 1;
        } else {
          const first = this.tokens[i++]; if (!named(first) || word(first) && ['LATERAL', 'JSON_TABLE', 'SELECT', 'WITH'].includes(first.value.toUpperCase())) throw Error('视图含未知表函数或关系语法');
          let database = this.database, table = first.value, qualifiedName = false;
          if (symbol(this.tokens[i], '.')) { qualifiedName = true; database = table; const second = this.tokens[++i]; if (!named(second)) throw Error('视图限定关系名称未知'); table = second.value; i++; }
          if (symbol(this.tokens[i], '(') || symbol(this.tokens[i], '.')) throw Error('视图表函数或多段限定名尚未证明');
          if (qualifiedName || !scope.has(table.toLowerCase()) && !word(first, 'DUAL')) { const value = { database, table }; this.refs.set(key(value), value); if (this.refs.size > renameViewLimits.references) throw Error('视图引用超过证明预算'); }
        }
        if (word(this.tokens[i], 'AS')) { i++; if (!named(this.tokens[i])) throw Error('视图关系别名缺失'); i++; }
        else if (this.tokens[i]?.kind === 'identifier' || word(this.tokens[i]) && !joinWords.has(this.tokens[i].value.toUpperCase()) && !['ON', 'USING', 'USE', 'FORCE', 'IGNORE', 'PARTITION'].includes(this.tokens[i].value.toUpperCase())) i++;
        // 分区/索引提示不是额外数据源，但必须完整消费其受控语法。
        while (word(this.tokens[i]) && ['USE', 'FORCE', 'IGNORE'].includes(this.tokens[i].value.toUpperCase())) { i++; if (!word(this.tokens[i], 'INDEX') && !word(this.tokens[i], 'KEY')) throw Error('视图索引提示未知'); i++; if (word(this.tokens[i], 'FOR')) { i++; if (word(this.tokens[i], 'JOIN')) i++; else if (word(this.tokens[i], 'ORDER') || word(this.tokens[i], 'GROUP')) { i++; if (!word(this.tokens[i++], 'BY')) throw Error('视图索引提示未知'); } else throw Error('视图索引提示未知'); } if (!symbol(this.tokens[i], '(')) throw Error('视图索引提示不完整'); const close = this.pairs.get(i)!; for (let j = i + 1; j < close; j++) if (!named(this.tokens[j]) && !symbol(this.tokens[j], ',')) throw Error('视图索引提示未知'); i = close + 1; }
        needRelation = false; continue;
      }
      if (symbol(this.tokens[i], ',')) { i++; needRelation = true; continue; }
      if (word(this.tokens[i]) && joinWords.has(this.tokens[i].value.toUpperCase())) {
        if (word(this.tokens[i], 'STRAIGHT_JOIN') || word(this.tokens[i], 'JOIN')) i++;
        else { if (word(this.tokens[i], 'NATURAL')) i++; if (word(this.tokens[i]) && ['INNER', 'CROSS', 'LEFT', 'RIGHT'].includes(this.tokens[i].value.toUpperCase())) i++; if (word(this.tokens[i], 'OUTER')) i++; if (!word(this.tokens[i++], 'JOIN')) throw Error('视图JOIN语法未知'); }
        needRelation = true; continue;
      }
      if (word(this.tokens[i], 'USING')) { i++; if (!symbol(this.tokens[i], '(')) throw Error('视图USING范围未知'); const close = this.pairs.get(i)!; for (let j = i + 1; j < close; j++) if (!named(this.tokens[j]) && !symbol(this.tokens[j], ',')) throw Error('视图USING列语法未知'); i = close + 1; continue; }
      if (word(this.tokens[i], 'ON')) {
        const from = ++i; for (; i < end; i++) { if (symbol(this.tokens[i], '(')) { i = this.pairs.get(i)!; continue; } if (symbol(this.tokens[i], ',') || word(this.tokens[i]) && joinWords.has(this.tokens[i].value.toUpperCase()) && !symbol(this.tokens[i + 1], '(')) break; }
        if (from === i) throw Error('视图ON条件为空'); this.expression(from, i, scope, depth + 1); continue;
      }
      throw Error('视图关系语法尚未完整证明');
    }
    if (needRelation) throw Error('视图缺少关系来源');
  }
  read(): RenameViewReference[] { if (!this.tokens.length) throw Error('视图定义为空'); this.query(0, this.tokens.length, new Set(), 0); return [...this.refs.values()]; }
}

/** 只接受完整单SELECT词法和受控关系语法，不调用宽容编辑器补全器，也不搜索名称子串。 */
export function tableRenameViewReferences(definition: string, database: string, context: TableDefinitionContext): RenameViewReference[] {
  if (typeof definition !== 'string' || Buffer.byteLength(definition) > renameViewLimits.definitionBytes) throw Error('视图定义超过单对象证明预算');
  // 三个已验旧基线在四种创建/读取模式下均输出固定反引号和反斜杠转义canonical正文；不能用当前NBE/ANSI误解存储正文。
  const canonical = { ...context, mode: { ansiQuotes: false, noBackslashEscapes: false } };
  return new ViewReferences(tableDefinitionTokens(definition, canonical), database).read();
}
/** 视图图遍历直接与间接引用；CTE不是全局视图，精确库名与表名不按原型键或子串匹配。 */
export function tableRenameViewsDependOn(views: readonly RenameViewDefinition[], target: RenameViewReference, context: TableDefinitionContext): boolean {
  const graph = new Map<string, RenameViewReference[]>(); let count = 0;
  for (const view of views) { if (graph.has(key(view))) throw Error('视图目录名称重复'); const refs = tableRenameViewReferences(view.definition, view.database, context); count += refs.length; if (count > renameViewLimits.references) throw Error('全局视图引用超过证明预算'); graph.set(key(view), refs); }
  const targetKey = key(target), memo = new Map<string, boolean>(), visiting = new Set<string>();
  const visit = (id: string, depth: number): boolean => { if (id === targetKey) return true; const cached = memo.get(id); if (cached !== undefined) return cached; if (visiting.has(id)) throw Error('全局视图引用循环，不能完整证明'); if (depth > renameViewLimits.depth) throw Error('全局视图链超过证明预算'); visiting.add(id); const found = (graph.get(id) ?? []).some(ref => visit(key(ref), depth + 1)); visiting.delete(id); memo.set(id, found); return found; };
  return [...graph.keys()].some(id => visit(id, 0));
}

/** 原始目录先验证自有标量，禁止getter/Proxy/toJSON；再计量，避免验证本身执行对象代码。 */
function scalarRow(value: unknown, fields: readonly string[]): Record<string, string> {
  if (!value || typeof value !== 'object' || types.isProxy(value) || Reflect.ownKeys(value).length !== fields.length) throw Error('视图目录行形状未知');
  const row: Record<string, string> = Object.create(null);
  for (const field of fields) { const descriptor = Object.getOwnPropertyDescriptor(value, field); if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'string') throw Error('视图目录缺少完整可见定义或原始标量'); row[field] = descriptor.value; }
  return row;
}
function arrayRows(value: unknown): unknown[] { if (types.isProxy(value) || !Array.isArray(value) || value.length > renameViewLimits.page + 1 || Reflect.ownKeys(value).length !== value.length + 1) throw Error('视图目录分页响应无界或稀疏'); const rows: unknown[] = []; for (let i = 0; i < value.length; i++) { const field = Object.getOwnPropertyDescriptor(value, String(i)); if (!field || !Object.hasOwn(field, 'value')) throw Error('视图目录数组不是原始行'); rows.push(field.value); } return rows; }
function name(value: string): boolean { return value.length > 0 && value.length <= 64 && !/[\0\u0001-\u001f\u007f]/.test(value); }
const order = (a: RenameViewReference, b: RenameViewReference) => Buffer.compare(Buffer.from(a.database), Buffer.from(b.database)) || Buffer.compare(Buffer.from(a.table), Buffer.from(b.table));
/** 两份独立完整来源分页到实际末页，系统视图同样纳入；没有前N项冒充完整性的分支。 */
async function catalog(context: StructureTaskContext, definitions: boolean): Promise<RenameViewDefinition[]> {
  const result: RenameViewDefinition[] = []; let last: RenameViewReference | undefined, bytes = 0;
  while (true) {
    const after = last ? ` AND (CAST(TABLE_SCHEMA AS BINARY)>CAST(${literal(last.database)} AS BINARY) OR (CAST(TABLE_SCHEMA AS BINARY)=CAST(${literal(last.database)} AS BINARY) AND CAST(TABLE_NAME AS BINARY)>CAST(${literal(last.table)} AS BINARY)))` : '';
    const source = definitions ? 'VIEWS' : 'TABLES', fields = definitions ? `,CASE WHEN OCTET_LENGTH(VIEW_DEFINITION)<=${renameViewLimits.definitionBytes} THEN VIEW_DEFINITION ELSE NULL END AS definition,CHARACTER_SET_CLIENT AS charset,COLLATION_CONNECTION AS collation` : '', where = definitions ? '1=1' : "TABLE_TYPE='VIEW'";
    const rows = arrayRows((await structureTaskQuery<unknown>(context, `SELECT TABLE_SCHEMA AS databaseName,TABLE_NAME AS viewName${fields} FROM information_schema.${source} WHERE ${where}${after} ORDER BY BINARY TABLE_SCHEMA,BINARY TABLE_NAME LIMIT ${renameViewLimits.page + 1}`)).rows);
    for (const raw of rows.slice(0, renameViewLimits.page)) {
      const row = scalarRow(raw, definitions ? ['databaseName', 'viewName', 'definition', 'charset', 'collation'] : ['databaseName', 'viewName']), value = { database: row.databaseName, table: row.viewName, definition: definitions ? row.definition : '', charset: definitions ? row.charset : '', collation: definitions ? row.collation : '' };
      if (!name(value.database) || !name(value.table) || last && order(last, value) >= 0 || definitions && (!value.definition || Buffer.byteLength(value.definition) > renameViewLimits.definitionBytes || !/^[A-Za-z0-9_]{1,64}$/.test(value.charset) || !/^[A-Za-z0-9_]{1,255}$/.test(value.collation))) throw Error('全局视图名称、顺序、定义或编码不完整');
      bytes += Buffer.byteLength(JSON.stringify(value)); if (bytes > renameViewLimits.bytes || result.length >= renameViewLimits.views) throw Error('全局视图清单超过完整性证明预算'); result.push(value); last = value;
    }
    context.checkCancelled(); if (rows.length <= renameViewLimits.page) return result;
  }
}
/** 从SHOW精确定位AS正文，不把DEFINER、注释或列名中的AS/VIEW当查询；末尾CHECK OPTION单独识别。 */
export function tableRenameShowViewBody(source: string, target: RenameViewReference, context: TableDefinitionContext): string {
  if (typeof source !== 'string' || source.length > renameViewLimits.definitionBytes + 8192 || Buffer.byteLength(source) > renameViewLimits.definitionBytes + 8192) throw Error('SHOW视图定义超过证明预算');
  // SHOW的首部及正文标识符遵循当前ANSI_QUOTES，但正文文字仍使用服务器canonical反斜杠转义。
  const tokens = tableDefinitionTokens(source, { ...context, mode: { ansiQuotes: context.mode.ansiQuotes, noBackslashEscapes: false } }); if (!word(tokens[0], 'CREATE') || tokens.some(token => token.kind === 'executable')) throw Error('SHOW视图首部未知');
  const view = tokens.findIndex(token => word(token, 'VIEW')); if (view < 1 || !named(tokens[view + 1])) throw Error('SHOW视图名称缺失');
  let i = view + 1, database = target.database, table = tokens[i++].value;
  if (symbol(tokens[i], '.')) { database = table; if (!named(tokens[++i])) throw Error('SHOW视图限定名缺失'); table = tokens[i++].value; }
  if (database !== target.database || table !== target.table) throw Error('SHOW视图名称与目录不一致');
  if (symbol(tokens[i], '(')) { let depth = 0; do { if (symbol(tokens[i], '(')) depth++; if (symbol(tokens[i], ')')) depth--; i++; if (i >= tokens.length) throw Error('SHOW视图列名不完整'); } while (depth); }
  if (!word(tokens[i++], 'AS') || !tokens[i]) throw Error('SHOW视图AS正文缺失');
  let end = tokens.length; const suffix = tokens.slice(-4); if (word(suffix[0], 'WITH') && (word(suffix[1], 'CASCADED') || word(suffix[1], 'LOCAL')) && word(suffix[2], 'CHECK') && word(suffix[3], 'OPTION')) end -= 4;
  else if (word(tokens[end - 3], 'WITH') && word(tokens[end - 2], 'CHECK') && word(tokens[end - 1], 'OPTION')) end -= 3;
  const start = tokens[i].start; let body = source.slice(start, tokens[end - 1].end);
  // 只正规化已经由词法证明的标识符引号；文字、注释及其它SQL逐字保留后与VIEWS交叉核对。
  for (const token of tokens.slice(i, end).filter(token => token.kind === 'identifier').reverse()) body = body.slice(0, token.start - start) + '`' + token.value.replaceAll('`', '``') + '`' + body.slice(token.end - start);
  return body.trim();
}
/** 旧版本缺少VIEW_TABLE_USAGE时，完整来源交叉+逐SHOW+全局图；全部查询只读且复用原短会话取消门。 */
export async function readTableRenameViewDependencies(context: StructureTaskContext, target: RenameViewReference, mode: TableDefinitionContext): Promise<{ dependent: boolean; digest: string; bytes: number }> {
  const names = await catalog(context, false), views = await catalog(context, true);
  if (JSON.stringify(names.map(key)) !== JSON.stringify(views.map(key))) throw Error('TABLES与VIEWS的完整可见视图清单不一致');
  for (const view of views) {
    const rows = arrayRows((await structureTaskQuery<unknown>(context, `SHOW CREATE VIEW ${qualified(view.database, view.table)}`)).rows); if (rows.length !== 1) throw Error('SHOW视图没有唯一完整定义');
    const row = scalarRow(rows[0], ['View', 'Create View', 'character_set_client', 'collation_connection']);
    if (row.View !== view.table || row.character_set_client !== view.charset || row.collation_connection !== view.collation || tableRenameShowViewBody(row['Create View'], view, mode) !== view.definition.trim()) throw Error('SHOW视图与VIEWS的名称、正文或编码不一致');
    context.checkCancelled();
  }
  const dependent = tableRenameViewsDependOn(views, target, mode), afterNames = await catalog(context, false), afterViews = await catalog(context, true);
  if (JSON.stringify(names) !== JSON.stringify(afterNames) || JSON.stringify(views) !== JSON.stringify(afterViews)) throw Error('全局视图来源在读取期间变化，请重新读取');
  const json = JSON.stringify(views); return { dependent, digest: createHash('sha256').update(json).digest('hex'), bytes: Buffer.byteLength(json) + 4096 };
}
