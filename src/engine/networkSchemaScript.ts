import type { ManagedConnection } from './connection';
import { completionQuery } from './completionQuery';
import { qualified, splitSql } from './sql';
import type { StructureTaskContext } from './structureDefinition';
import { parseTableColumnDefinition, tableDefinitionTokens } from './tableColumnDefinition';
import { assertStructureExportMode, assertTableStructureExportable } from '../shared/tableColumnPatches';
import { assertNetworkSchemaScript, networkSchemaDefinitionBytes, networkSchemaScriptSchema, type NetworkSchemaScriptOutput } from '../shared/networkSchemaScript';

/** 文件导出和 SQL 草稿共用原表定义保真校验，保留服务器给出的字节和对象身份。 */
export function assertNetworkTableExportable(managed: ManagedConnection, ddl: string, database: string, table: string): void {
  const mode = managed.sqlMode;
  assertStructureExportMode(mode);
  const modes = mode.toUpperCase().split(',');
  const document = parseTableColumnDefinition(ddl, { dialect: managed.status.dialect, mode: { noBackslashEscapes: modes.includes('NO_BACKSLASH_ESCAPES'), ansiQuotes: modes.includes('ANSI_QUOTES') } });
  assertTableStructureExportable(document, mode);
  if (document.table !== table || document.database !== undefined && document.database !== database) throw Error('结构定义与导出目标不一致，未生成结构 SQL');
}

/** 只在独立连接读取一次 SHOW CREATE，基本表和视图按真实返回字段严格区分。 */
export async function readNetworkSchemaScript(context: Pick<StructureTaskContext, 'managed' | 'checkCancelled' | 'commandStarted'>, raw: unknown): Promise<NetworkSchemaScriptOutput> {
  const source = networkSchemaScriptSchema.parse(raw), { managed } = context;
  const mode = managed.sqlMode;
  assertStructureExportMode(mode);
  if (!/^[A-Z0-9_,]*$/i.test(mode) || mode.length > 2048) throw Error('无法确认结构定义所需的服务器 SQL 模式');
  const type = source.kind === 'table' ? 'Table' : 'View';
  const { rows } = await completionQuery<Record<string, unknown>[]>(managed, context, `SHOW CREATE ${type.toUpperCase()} ${qualified(source.database, source.name)}`, []);
  const row = rows.length === 1 ? rows[0] : undefined, ddl = row?.['Create ' + type];
  if (row?.[type] !== source.name || typeof ddl !== 'string' || !ddl.trim() || ddl.includes('\0') || Buffer.byteLength(ddl) > networkSchemaDefinitionBytes) throw Error('服务器未返回对应对象的完整结构定义');
  if (source.kind === 'table') assertNetworkTableExportable(managed, ddl, source.database, source.name);
  const modes = mode.toUpperCase().split(',');
  const noBackslashEscapes = modes.includes('NO_BACKSLASH_ESCAPES'), ansiQuotes = modes.includes('ANSI_QUOTES');
  if (splitSql(ddl, noBackslashEscapes, ansiQuotes).length !== 1) throw Error('服务器结构定义不包含单个完整 CREATE 语句');
  if (source.kind === 'view') {
    const tokens = tableDefinitionTokens(ddl, { dialect: managed.status.dialect, mode: { noBackslashEscapes, ansiQuotes } });
    const keyword = (index: number, value: string) => tokens[index]?.kind === 'word' && tokens[index].value.toUpperCase() === value;
    const view = tokens.findIndex((_, index) => keyword(index, 'VIEW'));
    const qualified = tokens[view + 2]?.value === '.' && tokens[view + 2]?.kind === 'symbol';
    const name = tokens[view + (qualified ? 3 : 1)];
    if (!keyword(0, 'CREATE') || !['ALGORITHM', 'DEFINER', 'SQL', 'VIEW'].some(value => keyword(1, value)) || view < 1 || (qualified && tokens[view + 1]?.value !== source.database) || !name || !['identifier', 'word'].includes(name.kind) || name.value !== source.name) throw Error('视图定义与请求对象不一致');
  }
  context.checkCancelled();
  const sql = '-- DBArk 结构草稿。核对目标库和依赖对象后再执行。\n-- 源会话 SQL_MODE：' + (mode || '（空）') + '\n'
    + (source.kind === 'view' ? '-- 请核对原定义中的 DEFINER、权限及所引用的对象。\n' : '-- 脚本包含建表定义。依赖表及独立触发器需另行准备。\n')
    + ddl + (ddl.trimEnd().endsWith(';') ? '\n' : '\n;\n');
  return assertNetworkSchemaScript({ source, sql }, source);
}
