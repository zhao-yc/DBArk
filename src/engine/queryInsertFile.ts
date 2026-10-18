import type { CellValue } from '../shared/contracts';
import type { QueryExportColumn, QueryExportFrame } from '../shared/queryStreamExport';
import { queryStreamExportLimits as limits } from '../shared/queryStreamExport';
import { queryInsertTargetSchema, queryInsertLimits, type QueryInsertSample, type QueryInsertTarget } from '../shared/queryInsertExport';
import { queryInsertZh as text } from '../shared/queryInsertExport.zh-CN';
import { identifier, qualified, exportLiteral } from './sql';

const integerTypes = new Set(['TINY', 'SHORT', 'LONG', 'INT24', 'YEAR']);
const preciseTypes = new Set(['LONGLONG', 'DECIMAL', 'NEWDECIMAL']);
const floatTypes = new Set(['FLOAT', 'DOUBLE']);
const temporalTypes = new Set(['DATE', 'NEWDATE', 'DATETIME', 'TIMESTAMP', 'TIME', 'DATETIME2', 'TIMESTAMP2', 'TIME2']);
const textTypes = new Set(['VARCHAR', 'VAR_STRING', 'STRING', 'ENUM', 'SET', 'JSON', 'TINY_BLOB', 'MEDIUM_BLOB', 'LONG_BLOB', 'BLOB', 'BIT']);
const supportedTypes = new Set([...integerTypes, ...preciseTypes, ...floatTypes, ...temporalTypes, ...textTypes, 'NULL']);
const invalidUnicode = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;

/** 在构造十六进制文本前验证真实协议类型和值，不能用JSON化的几何对象冒充文本。 */
function literalBytes(value: CellValue, type: string): number {
  if (value === null) return 4;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0) || (!floatTypes.has(type) && !(integerTypes.has(type) && Number.isSafeInteger(value)))) throw Error(text.type);
    return String(value).length;
  }
  if (typeof value === 'string') {
    if (invalidUnicode.test(value) || value.length > limits.fieldBytes) throw Error(text.type);
    const bytes = Buffer.byteLength(value);
    if (bytes > limits.fieldBytes) throw Error(text.field);
    if (preciseTypes.has(type) && !(type === 'LONGLONG' ? /^[+-]?\d+$/ : /^[+-]?\d+(?:\.\d+)?$/).test(value)) throw Error(text.type);
    if (temporalTypes.has(type)) {
      const pattern = type.startsWith('TIME') && !type.startsWith('TIMESTAMP') ? /^-?\d{2,3}:\d{2}:\d{2}(?:\.\d{1,6})?$/ : ['DATE', 'NEWDATE'].includes(type) ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/;
      if (!pattern.test(value)) throw Error(text.type);
    }
    if (!preciseTypes.has(type) && !temporalTypes.has(type) && !textTypes.has(type)) throw Error(text.type);
    return bytes * 2 + 14;
  }
  if (!value || typeof value !== 'object' || !textTypes.has(type) || value.type !== 'binary' || typeof value.base64 !== 'string' || Object.keys(value).length !== 2 || !Object.hasOwn(value, 'type') || !Object.hasOwn(value, 'base64')) throw Error(text.type);
  if (value.base64.length > limits.fieldBytes) throw Error(text.field);
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.base64)) throw Error(text.type);
  const bytes = Buffer.from(value.base64, 'base64');
  if (bytes.toString('base64') !== value.base64) throw Error(text.type);
  return bytes.length * 2 + 3;
}

/** 独立逐帧消费者：只保留当前列定义和有界真实样例，文件输出始终逐行等待背压。 */
export class QueryInsertFile {
  private columns?: QueryExportColumn[];
  private ended = false;
  private count = 0;
  private sampleCount = 0;
  private sampleBytes = Buffer.byteLength(text.header);
  private readonly samples: string[] = [text.header];
  private readonly prefix: string;
  private readonly targetColumns: number;
  /** 构造只验证用户明确目标，不执行查询、预览查询或目录读取。 */
  constructor(target: QueryInsertTarget, private readonly write: (sql: string) => Promise<void>) {
    const parsed = queryInsertTargetSchema.parse(target);
    this.targetColumns = parsed.columns.length;
    this.prefix = `INSERT INTO ${qualified(parsed.database, parsed.table)} (${parsed.columns.map(identifier).join(', ')}) VALUES (`;
  }
  /** 结果结构不符立即拒绝；后续状态包也不能当作一个成功的完整导出。 */
  async consume(frame: QueryExportFrame): Promise<void> {
    if (frame.kind === 'rows-start') {
      if (this.columns || this.ended || frame.resultOrdinal !== 1 || frame.rowResultOrdinal !== 1 || frame.columns.length !== this.targetColumns || frame.columns.some((column,index) => column.position !== index + 1)) throw Error(text.mismatch);
      if(frame.columns.some(column=>!supportedTypes.has(column.type)))throw Error(text.type);
      this.columns = frame.columns.map(column => ({ ...column })); return;
    }
    if (!this.columns || this.ended || frame.resultOrdinal !== 1) throw Error(text.mismatch);
    if (frame.kind === 'rows-end') { this.ended = true; return; }
    if (frame.kind !== 'row' || frame.values.length !== this.columns.length) throw Error(text.mismatch);
    let size = Buffer.byteLength(this.prefix) + 3;
    for (let index=0;index<frame.values.length;index++) { size += literalBytes(frame.values[index],this.columns[index].type) + 2; if(size>limits.rowBytes) throw Error(text.field); }
    const sql = this.prefix + frame.values.map(exportLiteral).join(', ') + ');\n';
    await this.write(sql); this.count++;
    const bytes = Buffer.byteLength(sql);
    if(this.sampleCount < queryInsertLimits.sampleRows && this.sampleBytes + bytes <= queryInsertLimits.sampleBytes){this.samples.push(sql);this.sampleBytes+=bytes;this.sampleCount++;}
  }
  /** 完整结束才交出真实样例；空结果也必须有列定义和结束帧。 */
  complete(): QueryInsertSample {
    if (!this.columns || !this.ended) throw Error(text.incomplete);
    return {sql:this.samples.join(''),shownRows:this.sampleCount,totalRows:this.count};
  }
}
