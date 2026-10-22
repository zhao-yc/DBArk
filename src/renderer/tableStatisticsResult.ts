import type { CellValue } from '../shared/contracts';
import { tableStatisticsColumnKind, type TableStatisticsOutput } from '../shared/tableStatistics';
import { TableStatisticsIntent } from './tableStatisticsIntent';
import { cellPreview } from './lib';
import { tableStatisticsZh as text } from './locales/tableStatistics.zh-CN';

/** 数量只做整数等式核验，不把服务器BIGINT计数或数值聚合转换成Number。 */
function count(value: unknown): bigint { if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,19})$/.test(value)) throw Error(text.mismatch); return BigInt(value); }
/** 统计原值只接受协议标量/完整字节包装；有界预览不改写回执中的原字符串。 */
function cell(value: CellValue): void {
  if (value === null || typeof value === 'string' && value.length <= 262144 || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return;
  if (value && typeof value === 'object' && Object.keys(value).length === 2 && value.type === 'binary' && typeof value.base64 === 'string' && value.base64.length <= 349528 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.base64)) return;
  throw Error(text.mismatch);
}
/** 对象、所选字段顺序及总量全部核对后才展示，不能接纳旧源或另列的成功回包。 */
export function checkTableStatisticsOutput(intent: TableStatisticsIntent, columns: readonly string[], output: TableStatisticsOutput, distinct = false): void {
  if (!intent.current() || JSON.stringify(output.source) !== JSON.stringify(intent.source) || !/^[a-f0-9]{64}$/.test(output.sourceDigest) || !Array.isArray(output.columns) || output.columns.length !== columns.length || !Array.isArray(output.warnings) || output.warnings.some(warning => typeof warning !== 'string')) throw Error(text.mismatch);
  const total = count(output.rowCount);
  for (let index = 0; index < columns.length; index++) {
    const result = output.columns[index], original = intent.source.columns.find(column => column.name === columns[index]);
    if (!original || result.name !== original.name || result.type !== original.type || count(result.nonNull) + count(result.nulls) !== total) throw Error(text.mismatch);
    // 不同值仅属于本次显式请求的受支持列；自有 undefined 也不能冒充未请求的字段。
    const hasDistinct = Object.hasOwn(result, 'distinct');
    const expectedKind = tableStatisticsColumnKind(original.type);
    if (distinct && result.kind !== expectedKind) throw Error(text.mismatch);
    if (!distinct || expectedKind === 'count-only') { if (hasDistinct) throw Error(text.mismatch); }
    else {
      if (!hasDistinct || (result.kind !== 'numeric' && result.kind !== 'ordered')) throw Error(text.mismatch);
      const different = count(result.distinct), nonNull = count(result.nonNull);
      if (different > nonNull || nonNull > 0n && different === 0n) throw Error(text.mismatch);
    }
    if (result.kind === 'numeric') {
      cell(result.min); cell(result.max);
      if (typeof result.approximate !== 'boolean' || [result.sum, result.avg].some(value => value !== null && (typeof value !== 'string' || !value.length || value.length > 2048))) throw Error(text.mismatch);
      if (result.nonNull === '0' && (result.min !== null || result.max !== null || result.sum !== null || result.avg !== null)) throw Error(text.mismatch);
    } else if (result.kind === 'ordered') { cell(result.min); cell(result.max); if (result.nonNull === '0' && (result.min !== null || result.max !== null)) throw Error(text.mismatch); }
    else if (result.kind !== 'count-only' || typeof result.reason !== 'string' || !result.reason.length || result.reason.length > 4096) throw Error(text.mismatch);
  }
}
/** 实际NULL与文本“NULL”区分；文本/字节仅有界显示，精确数值字符串原样保留。 */
export function tableStatisticsCellPreview(value: CellValue): string { return value === null ? text.null : value === '' ? '""' : cellPreview(value, 240); }
