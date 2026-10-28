import { createHash } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import type { BigIntStats } from 'node:fs';
import type { DataRow } from '../shared/contracts';
import { importFileInspectInputSchema, importFileSampleRowBytes, importFileSourceSchema, importNewTableLimits as limits, importSourceColumn, type ImportFileInspectInput, type ImportFileInspectOutput, type ImportFileSource } from '../shared/importNewTable';
import { readRecords } from './files';

export interface ImportFileInspectProgress { records: number; bytes: number; }
type ReadInput = Pick<ImportFileInspectInput, 'format' | 'encoding' | 'csvDelimiter' | 'csvHasHeader'> & { filePath: string; expectedSource?: ImportFileSource };
/** 仅本模块构造的中文有界诊断可穿过解析错误边界，避免路径和源字段值进入任务历史。 */
class SourceReadError extends Error {}
const changed = () => new SourceReadError('源文件身份、大小、时间或完整内容已变化，请重新选择并检查；未确认本次导入完成');
/** lstat拒绝最终路径链接，纳秒时间和设备/节点身份均须保持，不将同长文件视为同一来源。 */
async function regularFile(path: string): Promise<BigIntStats> {
  try { const value = await lstat(path, { bigint: true }); if (!value.isFile() || value.isSymbolicLink() || value.size > BigInt(Number.MAX_SAFE_INTEGER)) throw changed(); return value; }
  catch { throw new SourceReadError('源文件不是可确认的普通文件，或已移动、替换，请重新选择'); }
}
function identical(before: BigIntStats, after: BigIntStats): boolean { return before.dev === after.dev && before.ino === after.ino && before.size === after.size && before.ctimeNs === after.ctimeNs && before.mtimeNs === after.mtimeNs; }

/** 全部摘要只来自同一条readRecords原字节链；提前return只收尾，不会产生完整核验证明。 */
async function* sourceRecords(input: ReadInput, checkCancelled: () => void, signal?: AbortSignal, onColumns?: (columns: string[]) => void, completed?: (source: ImportFileSource) => void, onBytes?: (bytes: number) => void): AsyncGenerator<DataRow> {
  const { filePath, expectedSource: rawExpected } = input;
  const selected = importFileInspectInputSchema.parse({ fileToken: '内部来源核验', taskId: '内部来源核验', format: input.format, encoding: input.encoding, ...(Object.hasOwn(input, 'csvDelimiter') ? { csvDelimiter: input.csvDelimiter } : {}), ...(Object.hasOwn(input, 'csvHasHeader') ? { csvHasHeader: input.csvHasHeader } : {}) }), expected = rawExpected === undefined ? undefined : importFileSourceSchema.parse(rawExpected);
  const check = () => { checkCancelled(); if (signal?.aborted) throw new SourceReadError('导入文件读取已取消'); };
  check(); const before = await regularFile(filePath); check(); const hash = createHash('sha256'); let bytes = 0;
  try {
    for await (const row of readRecords(filePath, selected.format, selected.encoding, selected.csvDelimiter, selected.csvHasHeader, { signal, onColumns: columns => { check(); onColumns?.(columns); }, onBytes: chunk => { check(); hash.update(chunk); bytes += chunk.length; if (!Number.isSafeInteger(bytes)) throw new SourceReadError('导入文件字节数超过可安全确认范围'); onBytes?.(bytes); } })) { check(); yield row; }
    check(); const after = await regularFile(filePath); check();
    if (!identical(before, after) || BigInt(bytes) !== before.size) throw changed();
    const source = { sha256: hash.digest('hex'), bytes };
    if (expected && (source.sha256 !== expected.sha256 || source.bytes !== expected.bytes)) throw changed(); completed?.(source);
  } catch (error) {
    // 先恢复原任务取消原因；其余第三方错误不能携带源行值、SQL或本机路径进入持久任务。
    check(); if (error instanceof SourceReadError) throw error;
    throw new SourceReadError('导入文件未完整读取或解析，请检查文件格式、编码和CSV配置');
  }
}

/** 扫完整文件发现联合源列，仅保留前20条有界完整样本；后续字段不被样本上限遮蔽。 */
export async function inspectImportFile(input: ImportFileInspectInput & { filePath: string }, checkCancelled: () => void, onProgress?: (value: ImportFileInspectProgress) => void, signal?: AbortSignal): Promise<ImportFileInspectOutput> {
  const { filePath, ...raw } = input, selected = importFileInspectInputSchema.parse(raw), names = new Set<string>(), rows: DataRow[] = [], completion: { source?: ImportFileSource } = {}; let records = 0, sampleBytes = 2, sampleFull = false;
  const columns = (values: string[]) => { for (const value of values) { let name: string; try { name = importSourceColumn(value); } catch { throw new SourceReadError('源字段名称超过256字符或编码无效，请先整理源文件'); } names.add(name); if (names.size > limits.columns) throw new SourceReadError('全文件联合源字段超过1000列，未截断字段目录'); } };
  // 字节进度由原raw观察器累计，不能另读文件或把解码字符数当作原字节数。
  let progressBytes = 0;
  for await (const row of sourceRecords({ ...selected, filePath }, checkCancelled, signal, columns, value => { completion.source = value; }, bytes => { progressBytes = bytes; })) {
    columns(Object.keys(row)); if (!Number.isSafeInteger(++records)) throw new SourceReadError('源记录总数超过可安全确认范围');
    if (records <= limits.sampleRows && !sampleFull) {
      const bytes = importFileSampleRowBytes(row, limits.sampleBytes - sampleBytes - (rows.length ? 1 : 0));
      if (sampleBytes + (rows.length ? 1 : 0) + bytes <= limits.sampleBytes) { rows.push(Object.fromEntries(Object.entries(row).map(([name, value]) => [name, value && typeof value === 'object' ? { ...value } : value]))); sampleBytes += (rows.length > 1 ? 1 : 0) + bytes; } else sampleFull = true;
    }
    if (records % 128 === 0) onProgress?.({ records, bytes: progressBytes });
  }
  const source = completion.source; checkCancelled(); if (signal?.aborted) throw new SourceReadError('导入文件读取已取消'); if (!source) throw new SourceReadError('未取得完整文件来源摘要，请重新检查文件'); onProgress?.({ records, bytes: source.bytes });
  return { columns: [...names], rows, records, source, sampleOmitted: records > rows.length };
}

/** 正式导入必须耗尽该迭代器后才COMMIT；末尾SHA/身份失败交由原整文件事务回滚。 */
export async function* readVerifiedImportRecords(input: ReadInput & { expectedSource: ImportFileSource }, checkCancelled: () => void, signal?: AbortSignal): AsyncGenerator<DataRow> {
  const expectedSource = importFileSourceSchema.parse(input.expectedSource);
  yield* sourceRecords({ ...input, expectedSource }, checkCancelled, signal);
}
