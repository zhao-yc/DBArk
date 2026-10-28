import type { FileChoice, ResultExportData } from '../shared/contracts';
import { fileImportPreflightIssueLimit, type FileImportPreflightInput, type FileImportPreflightReport } from '../shared/fileImportPreflight';
import { importPreflightZh as text } from './locales/importPreflight.zh-CN';

export interface ImportPreflightSource { identity: object; input: Omit<FileImportPreflightInput, 'taskId'>; }
export interface ImportPreflightServices {
  run(input: FileImportPreflightInput, isCurrent?: () => boolean): Promise<FileImportPreflightReport>;
  cancel(taskId: string): Promise<void>;
  chooseReport(): Promise<FileChoice | null>;
  exportReport(input: { fileToken: string; taskId: string; result: ResultExportData }): Promise<{ rows: number }>;
  uid(): string;
}
export interface ImportPreflightState { generation: number; report: FileImportPreflightReport | null; phase: 'idle' | 'running' | 'cancelling' | 'exporting'; message: string; }

/** 报告必须属于原输入；白名单投影避免驱动错误、字段原值和路径进入界面与导出。 */
export function validateImportPreflightReport(input: FileImportPreflightInput, report: FileImportPreflightReport): FileImportPreflightReport {
  const integer = (value: number) => Number.isSafeInteger(value) && value >= 0;
  const sha = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  if (!report || report.taskId !== input.taskId || report.target?.connectionId !== input.connectionId || report.target.database !== input.database || report.target.table !== input.table || report.format !== input.format || report.encoding !== input.encoding ||
    ![report.checkedRecords, report.validRecords, report.invalidRecords, report.issueCount, report.sourceBytes].every(integer) || report.validRecords + report.invalidRecords !== report.checkedRecords || report.issueCount < report.invalidRecords ||
    !Array.isArray(report.issues) || report.issues.length !== Math.min(report.issueCount, fileImportPreflightIssueLimit) || report.truncated !== (report.issueCount > report.issues.length) || typeof report.complete !== 'boolean' ||
    !['complete', 'parse-error', 'source-changed', 'schema-changed'].includes(report.termination) || report.complete !== (report.termination === 'complete') || !sha(report.schemaFingerprint) || !(report.sourceFingerprint === null || sha(report.sourceFingerprint)) || report.complete && !sha(report.sourceFingerprint)) throw Error(text.invalidReport);
  if (report.issueCount > report.checkedRecords * Object.keys(input.mapping).length + 3 || !report.complete && !report.issueCount) throw Error(text.invalidReport);
  const issues = Array.from(report.issues, issue => {
    if (!issue || !Object.hasOwn(text.issues, issue.code)) throw Error(text.invalidReport);
    const field = issue.code === 'missing-source' || issue.code === 'invalid-value';
    if (field && (!integer(issue.record!) || !issue.record || issue.record > report.checkedRecords || typeof issue.source !== 'string' || !Object.hasOwn(input.mapping, issue.source) || input.mapping[issue.source] !== issue.target) || !field && (issue.record !== undefined || issue.source !== undefined || issue.target !== undefined)) throw Error(text.invalidReport);
    return { ...(field ? { record: issue.record, source: issue.source, target: issue.target } : {}), code: issue.code, message: text.issues[issue.code] };
  });
  if (report.complete && issues.some(issue => issue.record === undefined)) throw Error(text.invalidReport);
  return { taskId: input.taskId, target: { connectionId: input.connectionId, database: input.database, table: input.table }, format: input.format, encoding: input.encoding,
    checkedRecords: report.checkedRecords, validRecords: report.validRecords, invalidRecords: report.invalidRecords, issueCount: report.issueCount, issues, truncated: report.truncated, complete: report.complete, termination: report.termination,
    sourceFingerprint: report.sourceFingerprint, sourceBytes: report.sourceBytes, schemaFingerprint: report.schemaFingerprint, warnings: [] };
}

/** 固定列集和首条汇总，即使没有错误也导出完整检查范围；绝不复制来源输入或原字段值。 */
export function importPreflightExportData(report: FileImportPreflightReport): ResultExportData {
  const keys = ['kind', 'formatVersion', 'connectionId', 'database', 'table', 'format', 'encoding', 'checkedRecords', 'validRecords', 'invalidRecords', 'issueCount', 'retainedIssues', 'complete', 'truncated', 'termination', 'sourceSHA256', 'schemaSHA256', 'record', 'source', 'target', 'code', 'message'];
  const base = { formatVersion: 1, ...report.target, format: report.format, encoding: report.encoding, checkedRecords: report.checkedRecords, validRecords: report.validRecords, invalidRecords: report.invalidRecords, issueCount: report.issueCount, retainedIssues: report.issues.length, complete: report.complete, truncated: report.truncated, termination: report.termination, sourceSHA256: report.sourceFingerprint, schemaSHA256: report.schemaFingerprint };
  const row = (values: Record<string, string | number | boolean | null | undefined>) => Object.fromEntries(keys.map(key => [key, values[key] ?? null]));
  return { columns: keys.map(key => ({ key, name: key })), rows: [row({ ...base, kind: 'summary' }), ...report.issues.map(issue => row({ ...base, kind: 'issue', record: issue.record, source: issue.source, target: issue.target, code: issue.code, message: text.issues[issue.code] }))], truncated: report.truncated };
}

/** 单一原任务持有占用直到终态；取消请求、换来源和卸载都不能提前释放或复活旧报告。 */
export class ImportPreflightController {
  state: ImportPreflightState = { generation: 0, report: null, phase: 'idle', message: '' };
  private source: ImportPreflightSource | null = null;
  private alive = true;
  private owner?: { source: ImportPreflightSource; generation: number; taskId: string; cancelled: boolean; cancellation?: Promise<void>; kind: 'run' | 'export' };
  constructor(private services: ImportPreflightServices, private activity: (delta: 1 | -1) => void, private changed: (state: ImportPreflightState) => void, private reportChanged?: (source: ImportPreflightSource, report: FileImportPreflightReport | null) => void) {}
  private publish(patch: Partial<ImportPreflightState>) { this.state = { ...this.state, ...patch }; if (this.alive) this.changed(this.state); }
  /** 来源代次单调递增，同一对象切走再切回也不能接受旧闭包。 */
  setSource(source: ImportPreflightSource | null) {
    if (this.source === source) return;
    const old = this.source; this.source = source;
    if (old) this.reportChanged?.(old, null);
    if (this.owner) this.owner.cancelled = true;
    this.publish({ generation: this.state.generation + 1, report: null, message: '' });
  }
  private current(owner: NonNullable<ImportPreflightController['owner']>) { return this.alive && this.owner === owner && !owner.cancelled && this.source === owner.source && this.state.generation === owner.generation; }
  /** 旧事件和重复点击在任何异步操作前拒绝。 */
  async run(generation: number, busy = false) {
    if (!this.alive || !this.source || this.owner || busy || generation !== this.state.generation) return;
    const source = this.source, input = { ...source.input, mapping: { ...source.input.mapping }, taskId: this.services.uid() };
    const owner: NonNullable<ImportPreflightController['owner']> = { source, generation, taskId: input.taskId, cancelled: false, kind: 'run' }; this.owner = owner;
    try { this.activity(1); } catch { this.owner = undefined; this.publish({ message: text.failed }); return; }
    try {
      this.publish({ report: null, phase: 'running', message: text.running }); this.reportChanged?.(source, null);
      const report = validateImportPreflightReport(input, await this.services.run(input, () => this.current(owner))); if (this.current(owner)) { this.publish({ report, message: '' }); this.reportChanged?.(source, report); }
    }
    catch (error) { if (this.current(owner)) this.publish({ message: error instanceof Error && error.message === text.invalidReport ? text.invalidReport : text.failed }); }
    finally {
      // 报告失效与取消请求分开记账；取消IPC仍在途时不放行新的任务或表单操作。
      if (owner.cancellation) await owner.cancellation;
      if (this.owner === owner) { this.owner = undefined; this.publish({ phase: 'idle', ...(owner.cancelled && this.source === source && generation === this.state.generation ? { message: text.cancelled } : {}) }); } this.activity(-1);
    }
  }
  /** 取消IPC仅发送一次，原run终态才释放占用；失败也保留owner。 */
  async cancel(generation: number) {
    const owner = this.owner;
    if (!this.alive || generation !== this.state.generation || !owner || owner.kind !== 'run' || owner.cancellation) return;
    owner.cancelled = true;
    owner.cancellation = Promise.resolve().then(() => this.services.cancel(owner.taskId)).catch(() => { if (this.alive && this.owner === owner) this.publish({ message: text.cancelFailed }); });
    this.publish({ phase: 'cancelling', message: text.cancelling });
    await owner.cancellation;
  }
  /** 选文件期间也占用；选完再次核验报告对象与代次，避免迟到文件框写出旧数据。 */
  async export(generation: number, report: FileImportPreflightReport, busy = false) {
    if (!this.alive || !this.source || this.owner || busy || generation !== this.state.generation || this.state.report !== report) return;
    const owner = { source: this.source, generation, taskId: this.services.uid(), cancelled: false, kind: 'export' as const }; this.owner = owner;
    try { this.activity(1); } catch { this.owner = undefined; this.publish({ message: text.exportFailed }); return; }
    this.publish({ phase: 'exporting', message: text.exporting });
    try {
      const file = await this.services.chooseReport();
      if (!file || !this.current(owner) || this.state.report !== report) return;
      const result = importPreflightExportData(report);
      const output = await this.services.exportReport({ fileToken: file.token, taskId: owner.taskId, result });
      if (this.current(owner) && this.state.report === report) this.publish({ message: output.rows === result.rows.length ? text.exported : text.exportFailed });
    } catch { if (this.current(owner)) this.publish({ message: text.exportFailed }); }
    finally { if (this.owner === owner) { this.owner = undefined; this.publish({ phase: 'idle', ...(this.state.message === text.exporting ? { message: '' } : {}) }); } this.activity(-1); }
  }
  /** 卸载只封闭发布；原异步finally仍须成对结束父层占用。 */
  dispose() { this.alive = false; if (this.owner) this.owner.cancelled = true; }
}
