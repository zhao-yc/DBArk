import type { FileChoice, TaskEvent } from '../shared/contracts';
import { importFileInspectInputSchema, importFileInspectOutputSchema, importNewTableSeedSchema, type ImportFileInspectInput, type ImportFileInspectOutput, type ImportNewTableSeed } from '../shared/importNewTable';
import { tableCreateDraftSchema, type TableCreateApplyOutput, type TableCreateDraft } from '../shared/tableCreate';
import { importNewTableZh as text } from './locales/importNewTable.zh-CN';

export interface ImportNewTableTarget { connectionId: string; database: string; version: number; }
export type ImportNewTableOptions = Pick<ImportFileInspectInput, 'format' | 'encoding' | 'csvDelimiter' | 'csvHasHeader'>;
export interface ImportNewTableServices {
  choose(input: { purpose: 'import'; format: 'csv' | 'json' }): Promise<FileChoice | null>;
  inspect(input: ImportFileInspectInput): Promise<ImportFileInspectOutput>;
  cancel(taskId: string): Promise<unknown>; uid(): string;
}
export interface ImportNewTableState {
  stage: 'source' | 'design' | 'created' | 'import'; options: ImportNewTableOptions; tableName: string; reviewed: boolean;
  busy: boolean; closing: boolean; invalid: boolean; childDirty: boolean; error?: string;
  file?: FileChoice; inspection?: ImportFileInspectOutput; design?: TableCreateDraft; seed?: ImportNewTableSeed;
  created?: TableCreateApplyOutput; progress?: { progress: number; message: string };
}
interface Operation { lifetime: object; cancelled: boolean; taskId: string; dispatched: boolean; promise: Promise<void>; cancellation?: Promise<void>; }
/** 与正式新表名称规则一致；原型键单独改为稳定建议名，映射仍安全保留原源键。 */
function legalName(value: string): boolean { return value.length > 0 && value.length <= 64 && !/[\u0000-\u001f\u007f\ud800-\udfff]/.test(value) && !/\s$/u.test(value); }
const prototypeKeys = new Set(['__proto__', 'prototype', 'constructor']);
/** 全文件列集合决定建议，不从前20行推断类型；预留合法原名防止回退名抢占后续原列。 */
export function importNewTableDesign(database: string, table: string, columns: readonly string[]): { design: TableCreateDraft; mapping: Record<string, string> } {
  const safe = (name: string) => legalName(name) && !prototypeKeys.has(name.toLowerCase());
  const reserved = new Set(columns.filter(safe).map(name => name.toLowerCase())), used = new Set<string>();
  const names = columns.map((source, index) => {
    let name = source;
    if (!safe(name) || used.has(name.toLowerCase())) {
      let suffix = index + 1; name = `column_${suffix}`;
      while (used.has(name.toLowerCase()) || reserved.has(name.toLowerCase())) name = `column_${++suffix}`;
    }
    used.add(name.toLowerCase()); return name;
  });
  const design = tableCreateDraftSchema.parse({ database, name: table, engine: 'InnoDB', charset: 'utf8mb4', comment: '', columns: names.map(name => ({ name, type: 'LONGTEXT', nullable: true, autoIncrement: false, comment: '' })), indexes: [], foreignKeys: [] });
  return { design, mapping: Object.fromEntries(columns.map((source, index) => [source, names[index]])) };
}

/** 两阶段向导只编排显式动作；真实建表与原子导入仍分别归正式设计器和传输组件所有。 */
export class ImportNewTableController {
  private value: ImportNewTableState = { stage: 'source', options: { format: 'csv', encoding: 'utf8', csvDelimiter: ',', csvHasHeader: true }, tableName: '', reviewed: false, busy: false, closing: false, invalid: false, childDirty: false };
  private lifetime: object | undefined; private active?: Operation; private child?: object; private childLifetime?: object;
  constructor(readonly target: ImportNewTableTarget, private readonly services: ImportNewTableServices, private readonly isCurrent: () => boolean, private readonly publish: (state: ImportNewTableState) => void, private readonly closed: () => void, private readonly created: (result: TableCreateApplyOutput, version: number) => void) {}
  get state(): ImportNewTableState { return this.value; }
  get dirty(): boolean { const options = this.value.options; return this.value.busy || this.value.closing || this.value.childDirty || this.value.stage !== 'source' || !!this.value.file || !!this.value.tableName || options.format !== 'csv' || options.encoding !== 'utf8' || options.csvDelimiter !== ',' || options.csvHasHeader !== true; }
  /** StrictMode每次挂载重新签发身份，旧Promise只保留真实终态锁，不能复活旧数据。 */
  mount(): void { this.lifetime = {}; this.update({}); }
  dispose(): void { this.lifetime = undefined; this.cancel(); }
  private update(patch: Partial<ImportNewTableState>): void { this.value = { ...this.value, ...patch }; if (this.lifetime) this.publish(this.value); }
  private current(): boolean {
    // 来源读取失败同样永久撤销；不能让作用域检查异常跳过原任务取消或关闭收尾。
    let valid = false; try { valid = this.isCurrent(); } catch { /* 按已失效处理，仍沿原任务收尾。 */ }
    if (!valid) this.invalidate(); return !!this.lifetime && !this.value.invalid;
  }
  private editable(expected: ImportNewTableState): boolean { return this.current() && !this.active && !this.value.closing && this.value === expected && this.value.stage === 'source'; }
  /** 直接订阅连接修订后永久失效，B→A不能因最终值相同恢复授权。 */
  invalidate(): void { if (this.value.invalid) return; this.update({ invalid: true, error: text.stale }); this.cancel(); }
  /** 来源选项变化同时消费整份旧扫描；旧渲染回调不能借新状态发请求。 */
  change(expected: ImportNewTableState, patch: Partial<ImportNewTableOptions>): void {
    if (!this.editable(expected)) return;
    const next = { ...this.value.options, ...patch };
    if (next.format !== 'csv' && next.format !== 'json' || !['utf8', 'utf16le', 'gb18030'].includes(next.encoding)) return;
    this.update({ options: next, file: undefined, inspection: undefined, reviewed: false, error: undefined, progress: undefined });
  }
  name(expected: ImportNewTableState, tableName: string): void { if (this.editable(expected)) this.update({ tableName, reviewed: false, error: undefined }); }
  review(expected: ImportNewTableState, reviewed: boolean): void { if (this.editable(expected)) this.update({ reviewed }); }
  /** 同一原任务只取消一次；终态事件和cancel ACK都不能代替原inspect Promise。 */
  cancel(): void {
    const active = this.active; if (!active || active.cancelled) return;
    active.cancelled = true;
    if (active.dispatched) active.cancellation = Promise.resolve().then(() => this.services.cancel(active.taskId)).then(() => undefined).catch(reason => { if (this.lifetime === active.lifetime) this.update({ error: reason instanceof Error ? reason.message : String(reason) }); });
    if (this.lifetime) this.update({ progress: { progress: 0, message: text.cancelling } });
  }
  /** 文件选择和全文件扫描共享同一锁；关闭先取消，随后等待原选择、扫描及取消全部结算。 */
  scan(expected: ImportNewTableState): Promise<void> {
    if (!this.editable(expected)) return Promise.resolve();
    const lifetime = this.lifetime!, options = { ...expected.options }; let active: Operation;
    const promise = Promise.resolve().then(async () => {
      if (!this.current() || this.lifetime !== lifetime || active.cancelled) return;
      const file = await this.services.choose({ purpose: 'import', format: options.format });
      if (!file || !this.current() || this.lifetime !== lifetime || active.cancelled) return;
      const request = importFileInspectInputSchema.parse({ fileToken: file.token, taskId: active.taskId, format: options.format, encoding: options.encoding, ...(options.format === 'csv' ? { csvDelimiter: options.csvDelimiter ?? ',', csvHasHeader: options.csvHasHeader ?? true } : {}) });
      active.dispatched = true;
      const inspection = importFileInspectOutputSchema.parse(await this.services.inspect(request));
      if (!this.current() || this.lifetime !== lifetime || active.cancelled || this.value.closing) return;
      this.update({ file: { ...file }, inspection, error: undefined, progress: undefined });
    }).catch(reason => { if (this.lifetime === lifetime && !this.value.invalid && !active.cancelled) this.update({ error: reason instanceof Error ? reason.message : String(reason) }); }).finally(async () => {
      await active.cancellation;
      if (this.active === active) { this.active = undefined; this.update({ busy: false }); }
    });
    active = { lifetime, cancelled: false, taskId: this.services.uid(), dispatched: false, promise }; this.active = active;
    this.update({ busy: true, file: undefined, inspection: undefined, reviewed: false, progress: undefined, error: undefined }); return promise;
  }
  progress(event: TaskEvent): void {
    const active = this.active;
    if (!active || !active.dispatched || active.cancelled || this.lifetime !== active.lifetime || event.taskId !== active.taskId || !this.current() || this.value.closing) return;
    if (Number.isFinite(event.progress) && event.progress >= 0 && event.progress <= 100 && typeof event.message === 'string') this.update({ progress: { progress: event.progress, message: event.message.slice(0, 2000) } });
  }
  /** 建表入口冻结完整源种子；名称须用户填写并显式核对，随后交正式设计器全部编辑。 */
  design(expected: ImportNewTableState): object | undefined {
    if (!this.editable(expected) || !expected.file || !expected.inspection) return;
    try {
      if (!expected.reviewed || !legalName(expected.tableName)) throw Error(text.reviewRequired);
      const plan = importNewTableDesign(this.target.database, expected.tableName, expected.inspection.columns), options = expected.options;
      const seed = importNewTableSeedSchema.parse({ file: expected.file, format: options.format, encoding: options.encoding, ...(options.format === 'csv' ? { csvDelimiter: options.csvDelimiter ?? ',', csvHasHeader: options.csvHasHeader ?? true } : {}), expectedSource: expected.inspection.source, columns: expected.inspection.columns, mapping: plan.mapping });
      this.child = {}; this.childLifetime = this.lifetime; this.update({ stage: 'design', design: plan.design, seed, childDirty: false, error: undefined }); return this.child;
    } catch (reason) { this.update({ error: reason instanceof Error ? reason.message : String(reason) }); }
  }
  get childLease(): object | undefined { return this.child; }
  private ownsExistingChild(lease: object, stage: 'design' | 'import'): boolean { return !!this.lifetime && this.childLifetime === this.lifetime && !this.value.closing && this.child === lease && this.value.stage === stage; }
  /** 子阶段每个网络入口复核原父租约；props/服务/连接对象ABA或卸载后均不能复活。 */
  isChildCurrent(lease: object, stage: 'design' | 'import'): boolean { return this.ownsExistingChild(lease, stage) && this.current(); }
  childDirty(lease: object, dirty: boolean): void { if (this.ownsExistingChild(lease, 'design') || this.ownsExistingChild(lease, 'import')) this.update({ childDirty: dirty }); }
  /** 只记录原准确DDL ACK，回调刷新不会卸载仍持有资源的设计器；不把未知结果变成可重建状态。 */
  receiveCreated(lease: object, result: TableCreateApplyOutput, version: number): void {
    if (!this.ownsExistingChild(lease, 'design') || this.value.created) return;
    if (version !== this.target.version || result.target.connectionId !== this.target.connectionId || result.target.database !== this.target.database || !legalName(result.target.table) || result.ddlCompleted !== true || result.ddlSubmitted !== true || typeof result.definitionVerified !== 'boolean' || typeof result.resourcesReleased !== 'boolean') { this.update({ error: text.changed }); return; }
    const receipt = structuredClone(result), current = this.current();
    // 晚失效不能抹掉原准确DDL完成事实，但不能借此向新配置刷新或开放导入。
    this.update({ created: receipt, error: !current ? text.createdStale : receipt.definitionVerified && receipt.resourcesReleased ? undefined : text.unverified });
    if (current) this.created(structuredClone(receipt), version);
  }
  /** 只有Schema确认其原资源释放并真正onClose后才切阶段，onCreated本身绝不卸载子组件。 */
  schemaClosed(lease: object): void {
    if (!this.ownsExistingChild(lease, 'design')) return;
    this.child = undefined;
    if (!this.current()) { this.closed(); return; }
    if (!this.value.created) { this.closed(); return; }
    this.update({ stage: 'created', childDirty: false });
  }
  /** 仅显式继续打开导入；源种子保持原文件/格式/指纹，目标表名取真实创建回应。 */
  continue(expected: ImportNewTableState): void {
    if (!this.current() || this.value !== expected || this.value.stage !== 'created' || this.value.closing || !expected.created?.definitionVerified || !expected.created.resourcesReleased || !expected.seed) return;
    this.child = {}; this.childLifetime = this.lifetime; this.update({ stage: 'import', childDirty: false });
  }
  importClosed(lease: object): void { if (this.ownsExistingChild(lease, 'import')) { this.child = undefined; this.closed(); } }
  /** 退出不回滚DDL；源读取中的关闭仍等待同一任务与取消真实终态。 */
  async close(expected: ImportNewTableState): Promise<void> {
    if (!this.lifetime || this.value !== expected || this.value.closing || this.value.stage === 'design' || this.value.stage === 'import') return;
    const lifetime = this.lifetime; this.update({ closing: true }); this.cancel(); const active = this.active;
    if (active) { await active.promise; await active.cancellation; }
    if (this.lifetime === lifetime) this.closed();
  }
}
