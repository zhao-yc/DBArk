import { editableColumnType, tableDefinitionTokens, type TableDefinitionToken } from './tableColumnDefinition';
import { structureDocumentOf, structureTaskQuery, type StructureTaskContext } from './structureDefinition';
import type { TableCommentRead } from './tableCommentRead';
import type { TableColumnDefinitionDocument } from '../shared/tableColumnPatches';
import { tableCopyGeneratedText as text, type TableCopyGeneratedColumn } from '../shared/tableCopyStructureGenerated';

export interface TableCopyGeneratedPlan { columns: TableCopyGeneratedColumn[]; catalog: Record<string, unknown>[]; bytes: number; }
/** 首片仅让整数/DECIMAL参与生成与引用，不把浮点、字符串、时间或未知类型当精确数值。 */
const numeric = (document: TableColumnDefinitionDocument, index: number) => {
  const type = editableColumnType(document.columns[index], document.context); return type?.kind === 'integer' || type?.kind === 'decimal';
};
/** 去掉仅包围整个表达式的外括号，保留内部结合顺序、文字量精度和每次引用；绝不计算或重排。 */
function projection(tokens: TableDefinitionToken[]): string {
  while (tokens[0]?.value === '(' && tokens.at(-1)?.value === ')') {
    let depth = 0, wraps = true;
    for (let index = 0; index < tokens.length - 1; index++) { if (tokens[index].value === '(') depth++; if (tokens[index].value === ')') depth--; if (!depth) { wraps = false; break; } }
    if (!wraps) break; tokens = tokens.slice(1, -1);
  }
  return JSON.stringify(tokens.map(token => [token.kind, token.value]));
}
/** 只检查有界算术语法，不eval、不换算数值；引用必须准确指向前置普通数值列，拒绝生成链/自增引用。 */
function expression(source: string, document: TableColumnDefinitionDocument, columnIndex: number): { tokens: TableDefinitionToken[]; references: string[] } {
  if (source.length > 2048 || /\/\*|--|#/.test(source)) throw Error(text.expression);
  const tokens = tableDefinitionTokens(source, document.context), references: string[] = []; let cursor = 0;
  if (!tokens.length || tokens.length > 256) throw Error(text.expression);
  const value = (depth: number): void => {
    if (depth > 16) throw Error(text.expression);
    const token = tokens[cursor++]; if (!token) throw Error(text.expression);
    if (token.kind === 'symbol' && ['+', '-'].includes(token.value)) { value(depth + 1); return; }
    if (token.kind === 'symbol' && token.value === '(') { sum(depth + 1); if (tokens[cursor++]?.value !== ')') throw Error(text.expression); return; }
    if (token.kind === 'number' && /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(token.value) && token.value.replace('.', '').length <= 65) return;
    // SHOW已要求sql_quote_show_create=1；只接受明确引用名，不能把裸关键字或无括号函数猜成列。
    if (token.kind !== 'identifier') throw Error(text.expression);
    const index = document.columns.findIndex(column => column.name === token.value), column = document.columns[index];
    if (index < 0 || index >= columnIndex || !numeric(document, index) || !column.access.type.editable || column.attributes.some(attribute => attribute.kind === 'auto-increment') || references.length >= 32) throw Error(text.expression);
    references.push(column.name);
  };
  const product = (depth: number): void => { value(depth); while (tokens[cursor]?.kind === 'symbol' && tokens[cursor].value === '*') { cursor++; value(depth); } };
  const sum = (depth: number): void => { product(depth); while (tokens[cursor]?.kind === 'symbol' && ['+', '-'].includes(tokens[cursor].value)) { cursor++; product(depth); } };
  sum(0); if (cursor !== tokens.length) throw Error(text.expression);
  return { tokens, references };
}
/** 从完整SHOW的已解析属性恢复明确存储方式及原表达式范围；不把生成列当默认值或解除通用只读标记。 */
export function tableCopyGeneratedDefinition(document: TableColumnDefinitionDocument, version: string): TableCopyGeneratedColumn[] {
  if (document.context.dialect !== 'mysql' || !/^8\.4\.11(?:[-+][^\s]+)?$/.test(version) || /\s/.test(version) || /mariadb/i.test(version)) throw Error(text.unsupported);
  const result: TableCopyGeneratedColumn[] = [];
  for (const [index, column] of document.columns.entries()) {
    const generated = column.attributes.filter(attribute => attribute.kind === 'generated'); if (!generated.length) continue;
    if (result.length >= 32 || generated.length !== 1 || !column.type.known || !numeric(document, index) || column.default.kind !== 'none' || column.attributes.some(attribute => !['generated', 'nullable', 'comment'].includes(attribute.kind))) throw Error(text.expression);
    const attribute = generated[0], tokens = tableDefinitionTokens(attribute.raw, document.context), storage = tokens.at(-1)?.value.toUpperCase();
    if (tokens[0]?.value.toUpperCase() !== 'GENERATED' || tokens[1]?.value.toUpperCase() !== 'ALWAYS' || tokens[2]?.value.toUpperCase() !== 'AS' || tokens[3]?.value !== '(' || tokens.at(-2)?.value !== ')' || !['VIRTUAL', 'STORED'].includes(storage ?? '')) throw Error(text.expression);
    const raw = attribute.raw.slice(tokens[3].end, tokens.at(-2)!.start), parsed = expression(raw, document, index);
    result.push({ name: column.name, storage: storage as 'VIRTUAL' | 'STORED', expression: raw, referencedColumns: parsed.references });
  }
  // 普通默认表达式若引用生成列，属于更复杂依赖；原有不含生成列路径完全不受影响。
  if (document.columns.some(column => column.default.kind === 'expression' && tableDefinitionTokens(column.default.sql, document.context).some(token => ['word', 'identifier'].includes(token.kind) && result.some(generated => generated.name === token.value)))) throw Error(text.expression);
  return result;
}
/** SHOW或已有EXTRA出现生成标记时才增加目录读取；普通列/自增路径不额外发SQL。 */
export async function readTableCopyGenerated(context: StructureTaskContext, target: { database: string; table: string }, read: TableCommentRead): Promise<TableCopyGeneratedPlan | undefined> {
  const document = structureDocumentOf(read), hasGenerated = document.columns.some(column => column.attributes.some(attribute => attribute.kind === 'generated'));
  const observedGenerated = read.columnExtras?.some(([, extra]) => typeof extra === 'string' && /\bGENERATED\b/i.test(extra));
  if (!hasGenerated && !observedGenerated) return;
  const columns = tableCopyGeneratedDefinition(document, read.serverVersion);
  if (!columns.length || !read.columnExtras || read.columnExtras.length !== document.columns.length) throw Error(text.catalog);
  const literal = (value: string) => `CONVERT(X'${Buffer.from(value).toString('hex')}' USING utf8mb4)`;
  const rows = (await structureTaskQuery<Record<string, unknown>[]>(context, `SELECT COLUMN_NAME AS name, ORDINAL_POSITION AS ordinal, DATA_TYPE AS dataType, COLUMN_TYPE AS columnType, IS_NULLABLE AS nullable, EXTRA AS extra, COLUMN_DEFAULT AS defaultValue, GENERATION_EXPRESSION AS generationExpression FROM information_schema.COLUMNS WHERE CAST(TABLE_SCHEMA AS BINARY)=CAST(${literal(target.database)} AS BINARY) AND CAST(TABLE_NAME AS BINARY)=CAST(${literal(target.table)} AS BINARY) ORDER BY ORDINAL_POSITION LIMIT 4097`)).rows;
  if (!Array.isArray(rows) || rows.length !== document.columns.length || rows.length > 4096 || Buffer.byteLength(JSON.stringify(rows)) > 4 * 1024 * 1024) throw Error(text.catalog);
  const type = (raw: string) => JSON.stringify(tableDefinitionTokens(raw, read.context).map(token => [token.kind, token.kind === 'word' ? token.value.toUpperCase() : token.value]));
  const catalog: Record<string, unknown>[] = [];
  for (const [index, row] of rows.entries()) {
    const column = document.columns[index], generated = columns.find(item => item.name === column.name), prior = read.columnExtras[index];
    if (row.name !== column.name || String(row.ordinal) !== String(index + 1) || typeof row.columnType !== 'string' || typeof row.dataType !== 'string' || row.columnType.split(/[ (]/)[0].toLowerCase() !== row.dataType.toLowerCase() || type(row.columnType) !== type(column.type.raw) || !['YES', 'NO'].includes(row.nullable as string) || (row.nullable === 'YES') !== column.nullable || prior[0] !== row.name || prior[1] !== row.extra || typeof row.extra !== 'string' || typeof row.generationExpression !== 'string' || !(row.defaultValue === null || typeof row.defaultValue === 'string')) throw Error(text.catalog);
    if (generated) {
      if (row.extra !== generated.storage + ' GENERATED' || row.defaultValue !== null || projection(expression(row.generationExpression, document, index).tokens) !== projection(expression(generated.expression, document, index).tokens)) throw Error(text.catalog);
    } else if (row.generationExpression !== '' || !['', 'auto_increment', 'DEFAULT_GENERATED'].includes(row.extra) || row.extra === 'DEFAULT_GENERATED' && column.default.kind !== 'expression') throw Error(text.catalog);
    catalog.push({ name: row.name, ordinal: String(row.ordinal), dataType: row.dataType, columnType: row.columnType, nullable: row.nullable, extra: row.extra, defaultValue: row.defaultValue, generationExpression: row.generationExpression });
  }
  return { columns, catalog, bytes: Buffer.byteLength(JSON.stringify([columns, catalog])) };
}
