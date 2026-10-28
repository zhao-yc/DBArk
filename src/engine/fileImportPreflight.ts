import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { setImmediate } from 'node:timers/promises';
import type { TableInfo } from '../shared/contracts';
import { fileImportPreflightIssueLimit, type FileImportPreflightInput, type FileImportPreflightIssue, type FileImportPreflightProgress, type FileImportPreflightReport } from '../shared/fileImportPreflight';
import { readRecords } from './files';
import { validateLosslessImport } from './losslessImport';
import { tableInfo, type MetadataQuery } from './metadata';
import { inlineParameters, typedCellPlaceholder } from './sql';
import { structureTaskQuery, type StructureTaskContext } from './structureDefinition';

/** 指纹仅包含本次逐字段校验真正使用的完整定义，不包含自增计数等动态目录值。 */
function schemaFingerprint(info: TableInfo): string {
  return createHash('sha256').update(JSON.stringify([info.engine, info.objectKind, info.columns.map(column => [column.name, column.type, column.nullable, column.defaultValue, column.extra, column.comment, column.generated, column.characterSet ?? null])])).digest('hex');
}
/** 比较文件身份及时间、大小；完整SHA只由本轮同一读取链生成。 */
function sourceIdentity(value: Awaited<ReturnType<typeof stat>>): string {
  return JSON.stringify([value.dev, value.ino, value.size, value.mtimeMs, value.ctimeMs]);
}

/** 整文件只读校验：目录命令沿原任务取消与收尾，不读取目标记录、不建立事务。 */
export async function preflightImportFile(context: StructureTaskContext, input: FileImportPreflightInput & { filePath: string }, onProgress?: (progress: FileImportPreflightProgress) => void): Promise<FileImportPreflightReport> {
  const checkCancelled = () => { context.checkCancelled(); context.managed.signal?.throwIfAborted(); };
  const query: MetadataQuery = async <T>(sql: string, params: (string | number | boolean | null | Buffer)[] = []) => structureTaskQuery<T>(context, inlineParameters(sql, params.map(value => Buffer.isBuffer(value) ? { type: 'binary' as const, base64: value.toString('base64') } : value)));
  const readInfo = () => tableInfo(context.managed, input.database, input.table, query);
  checkCancelled();
  const info = await readInfo(); checkCancelled();
  const columns = new Map(info.columns.map(column => [column.name, column])), mapping = Object.entries(input.mapping);
  if (!mapping.length) throw Error('请至少映射一个源字段');
  if (new Set(mapping.map(([, target]) => target)).size !== mapping.length) throw Error('多个源字段不能映射到同一个目标字段');
  for (const [, target] of mapping) if (!columns.has(target) || columns.get(target)!.generated) throw Error('映射目标不存在或为生成列，请重新读取字段');
  const before = await stat(input.filePath); checkCancelled();
  if (!before.isFile()) throw Error('预检来源必须为普通文件');
  const report: FileImportPreflightReport = {
    taskId: input.taskId, target: { connectionId: input.connectionId, database: input.database, table: input.table }, format: input.format, encoding: input.encoding,
    checkedRecords: 0, validRecords: 0, invalidRecords: 0, issueCount: 0, issues: [], truncated: false, complete: false, termination: 'complete',
    sourceFingerprint: null, sourceBytes: 0, schemaFingerprint: schemaFingerprint(info), warnings: [
      '本次只检查已映射字段；未映射列、默认值及导入匹配策略仍需在正式导入时核对。',
      '本次不读取目标记录，不保证唯一键、外键、CHECK、触发器、匹配键及服务器实时状态检查通过。',
      '预检结果不是导入授权或执行令牌；文件、映射、连接或字段变化后须重新预检，正式导入仍逐项校验。',
      '前后字段指纹相同不保证期间或之后未发生结构变化，也不覆盖所有服务器对象定义。'
    ]
  };
  /** 明细达到预算后仍扫描和计数；不保存行值、驱动错误或文件路径。 */
  const issue = (value: FileImportPreflightIssue) => { report.issueCount++; if (report.issues.length < fileImportPreflightIssueLimit) report.issues.push(value); report.truncated = report.issueCount > report.issues.length; };
  const progress = () => onProgress?.({ checkedRecords: report.checkedRecords, validRecords: report.validRecords, invalidRecords: report.invalidRecords, issueCount: report.issueCount, sourceBytes: report.sourceBytes });
  const hash = createHash('sha256');
  let finished = false;
  try {
    for await (const row of readRecords(input.filePath, input.format, input.encoding, input.csvDelimiter, input.csvHasHeader, { signal: context.managed.signal, onBytes: chunk => { hash.update(chunk); report.sourceBytes += chunk.length; } })) {
      checkCancelled(); report.checkedRecords++;
      let invalid = false;
      for (const [source, target] of mapping) {
        if (!Object.hasOwn(row, source)) { invalid = true; issue({ record: report.checkedRecords, source, target, code: 'missing-source', message: '源记录缺少已映射字段' }); continue; }
        const column = columns.get(target)!;
        let value = row[source];
        // 与正式CSV导入的二进制协议一致；文本列不会误解释base64前缀。
        if (input.format === 'csv' && typeof value === 'string' && value.startsWith('base64:') && /^(?:tinyblob|blob|mediumblob|longblob|binary|varbinary|bit)/i.test(column.type)) value = { type: 'binary', base64: value.slice(7) };
        try { validateLosslessImport(column, value, context.managed.status.dialect); typedCellPlaceholder(column, value); }
        catch { invalid = true; issue({ record: report.checkedRecords, source, target, code: 'invalid-value', message: '字段值不能确认满足目标类型、空值或无损表示要求' }); }
      }
      if (invalid) report.invalidRecords++; else report.validRecords++;
      if (report.checkedRecords % 128 === 0) { progress(); await setImmediate(); checkCancelled(); }
    }
    finished = true;
  } catch {
    // 取消须由原任务处理，不能伪装成可继续使用的解析错误报告。
    checkCancelled(); report.termination = 'parse-error';
    issue({ code: 'parse-error', message: '源文件未完整读取或解析；仅列出此前已完成的记录，无法确认失败记录编号' });
  }
  checkCancelled();
  let unchanged = false;
  try { const after = await stat(input.filePath); unchanged = after.isFile() && sourceIdentity(before) === sourceIdentity(after); } catch { /* 文件消失同样使本轮来源失效。 */ }
  checkCancelled();
  if (!unchanged || finished && report.sourceBytes !== before.size) {
    report.termination = 'source-changed'; issue({ code: 'source-changed', message: '源文件身份、大小或修改时间已变化，请重新选择并预检' });
  } else if (finished) report.sourceFingerprint = hash.digest('hex');
  const afterInfo = await readInfo(); checkCancelled();
  if (schemaFingerprint(afterInfo) !== report.schemaFingerprint) {
    report.termination = 'schema-changed'; issue({ code: 'schema-changed', message: '目标字段定义已变化，请重新读取映射并预检' });
  }
  report.complete = finished && report.termination === 'complete'; progress();
  return report;
}
