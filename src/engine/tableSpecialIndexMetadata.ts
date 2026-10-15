import { tableDefinitionTokens } from './tableColumnDefinition';
import type { IndexColumnMetadata } from './tableIndexMetadata';
import type { TableColumnDefinition, TableDefinitionContext } from '../shared/tableColumnPatches';
import type { TrustedIndexColumn } from '../shared/tableIndexPatches';

/** 目录整数和原SRID必须同时完整，不能把NULL、截断数字或访问失败当成SRID 0。 */
function sridInteger(value: unknown): number | undefined {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,9})$/.test(value))) return undefined;
  const result = Number(value); return Number.isSafeInteger(result) && result >= 0 && result <= 4294967295 ? result : undefined;
}

/** 仅开放列类型、附加属性和真实目录均明确的特殊索引字段，普通BTREE能力保持独立。 */
export function deriveSpecialIndexColumn(parsed: TableColumnDefinition, metadata: IndexColumnMetadata, column: TrustedIndexColumn, context: TableDefinitionContext, serverVersion: string, sridDirectoryAvailable: boolean): NonNullable<TrustedIndexColumn['specialIndexes']> {
  const common: string[] = [], fulltext: string[] = [], spatial: string[] = [];
  if (column.generated || column.hidden) common.push('生成列或隐藏列的特殊索引本批只读');
  if (column.name.toUpperCase() === 'FTS_DOC_ID') common.push('全文文档定位列由服务器或人工专门管理');
  const mysql8 = context.dialect === 'mysql' && /^8\./.test(serverVersion);
  const tokens = tableDefinitionTokens(parsed.raw, context), executable = tokens.filter(token => token.kind === 'executable');
  const sridComment = /^\/\*!80003\s+SRID\s+(0|[1-9]\d{0,9})\s*\*\/$/i;
  // MySQL SHOW CREATE常用此版本注释；仅在目录再证实后解释SRID，不执行注释内容。
  const acceptedComment = mysql8 && executable.length === 1 && sridComment.test(executable[0].value) ? executable[0] : undefined;
  if (executable.length && !acceptedComment) common.push('字段包含未证明的可执行属性');
  if (!parsed.type.known || parsed.attributes.some(attribute => attribute.kind === 'opaque' && !(acceptedComment && attribute.raw.trim() === acceptedComment.value.trim()))) common.push('字段包含无法保真的附加属性');
  const extra = metadata.EXTRA.replace(/\b(?:VIRTUAL|STORED|PERSISTENT) GENERATED\b/ig, '').replace(/\b(?:DEFAULT_GENERATED|auto_increment|INVISIBLE|VISIBLE)\b/ig, '').trim();
  if (extra) common.push('字段目录附加属性未知');
  if (!/^(?:CHAR|VARCHAR|TINYTEXT|TEXT|MEDIUMTEXT|LONGTEXT)$/.test(column.dataType)) fulltext.push('全文索引仅接受CHAR、VARCHAR或TEXT系列字段');
  if (!column.charset || !column.collation || /^(?:binary|ucs2|utf16|utf16le|utf32)$/i.test(column.charset)) fulltext.push('全文字段字符集或排序规则缺失或不受支持');
  if (!/^(?:GEOMETRY|POINT|LINESTRING|POLYGON|MULTIPOINT|MULTILINESTRING|MULTIPOLYGON|GEOMETRYCOLLECTION)$/.test(column.dataType)) spatial.push('空间索引仅接受明确空间字段');
  if (column.nullable) spatial.push('空间字段必须已经NOT NULL');
  let srid: number | undefined;
  if (mysql8) {
    const declared = parsed.attributes.filter(attribute => attribute.kind === 'srid');
    let raw: unknown;
    if (declared.length === 1 && !acceptedComment) raw = /^SRID\s+(?:=\s*)?(0|[1-9]\d{0,9})$/i.exec(declared[0].raw.trim())?.[1];
    else if (!declared.length && acceptedComment) raw = sridComment.exec(acceptedComment.value)?.[1];
    const descriptor = Object.getOwnPropertyDescriptor(metadata, 'SRS_ID'), actual = descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
    const sourceSrid = sridInteger(raw), catalogSrid = sridInteger(actual);
    if (!sridDirectoryAvailable || sourceSrid === undefined || catalogSrid === undefined || sourceSrid !== catalogSrid) spatial.push('MySQL8必须确认源显式SRID与独立SRS_ID目录一致');
    else srid = sourceSrid;
  } else if (parsed.attributes.some(attribute => attribute.kind === 'srid') || executable.length) spatial.push('当前版本的SRID声明尚未证明');
  const result = (reasons: string[]) => { const all = [...new Set([...common, ...reasons])]; return { allowed: all.length === 0, reasons: all }; };
  return { fulltext: result(fulltext), spatial: result(spatial), ...(srid === undefined ? {} : { srid }) };
}
