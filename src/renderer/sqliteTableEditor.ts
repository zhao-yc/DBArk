import type { SqliteTablePage } from '../shared/sqliteTableBrowse';
import { sqliteEditValueSchema, sqliteTableEditPreviewSchema, sqliteTableEditLimits, type SqliteOriginalValue, type SqliteTableChange, type SqliteTableEditPreview, type SqliteTableEditOutcome } from '../shared/sqliteTableEdit';
import { sqliteTableEditZh as text } from './locales/sqliteTableEdit.zh-CN';

export interface SqliteDraftRow { id: string; index?: number; values: (SqliteOriginalValue | undefined)[]; deleted: boolean; }
export interface SqliteEditView { page: SqliteTablePage; rows: SqliteDraftRow[]; dirty: boolean; busy: boolean; valid: boolean; unknown: boolean; undo: boolean; redo: boolean; message: string; preview?: SqliteTableEditPreview; taskId?: string; }
interface Lease { owns(): boolean; release(): boolean; }
interface Ports { current(): boolean; active(): boolean; available(): boolean; acquire(): Lease; id(): string; now(): number; changed(view: SqliteEditView): void; dirty(value: boolean): void; preview(input: { snapshotId: string; taskId: string; changes: SqliteTableChange[] }): Promise<SqliteTableEditPreview>; apply(input: { previewId: string; taskId: string; confirmation: string }): Promise<SqliteTableEditOutcome>; release(input: { snapshotId?: string; previewId?: string }): Promise<unknown>; cancel(taskId: string): Promise<unknown>; committed(): void; }
interface Operation { id: string; kind: 'preview' | 'apply'; acquiring: boolean; lease?: Lease; sent: boolean; cancelled: boolean; cancel?: Promise<unknown>; }
/** 先验完整稠密自有data数组；巨量length先拒绝，不map或读取任何索引getter。 */
function appendArray(value: unknown, minimum: number, maximum: number): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) throw Error(text.invalid);
  const length = Object.getOwnPropertyDescriptor(value, 'length'); if (!length || !('value' in length) || !Number.isInteger(length.value) || length.value < minimum || length.value > maximum || Reflect.ownKeys(value).length !== length.value + 1) throw Error(text.invalid);
  for (let index = 0; index < length.value; index++) { const item = Object.getOwnPropertyDescriptor(value, String(index)); if (!item?.enumerable || !('value' in item)) throw Error(text.invalid); }
  return value;
}
/** 只取纯对象的自有data字段，先复制再交原typed schema，禁止校验过程触发getter。 */
function appendValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw Error(text.invalid);
  const keys = Reflect.ownKeys(value); if (!keys.length || keys.length > 2) throw Error(text.invalid); const copied = Object.create(null) as Record<string, unknown>;
  for (const key of keys) { const item = Object.getOwnPropertyDescriptor(value, key); if (typeof key !== 'string' || !item?.enumerable || !('value' in item)) throw Error(text.invalid); copied[key] = item.value; } return copied;
}
/** 原值只用于本地展示和差异判断；写入合同仅包含原页 row 编号与显式 typed 修改。 */
export function sqliteDraftChanges(page: SqliteTablePage, rows: readonly SqliteDraftRow[]): SqliteTableChange[] {
  if (page.edit?.kind !== 'editable') return [];
  const columns = page.edit.columns, originals = page.edit.rows;
  return rows.flatMap<SqliteTableChange>(row => {
    if (row.index === undefined) return row.deleted ? [] : [{ kind: 'insert', values: columns.flatMap((column, i) => column.generated || row.values[i] === undefined ? [] : [{ column: column.name, value: sqliteEditValueSchema.parse(row.values[i]) }]) }];
    if (row.deleted) return [{ kind: 'delete', row: row.index }];
    const values = columns.flatMap((column, i) => column.generated || JSON.stringify(row.values[i]) === JSON.stringify(originals[row.index!][i]) ? [] : [{ column: column.name, value: sqliteEditValueSchema.parse(row.values[i]) }]);
    return values.length ? [{ kind: 'update', row: row.index, values }] : [];
  });
}
/** 独立草稿账本持有准确快照；离开活动标签可保留，来源 ABA 或未知提交永久撤销原批次。 */
export class SqliteTableEditor {
  private rows: SqliteDraftRow[]; private past: SqliteDraftRow[][] = []; private future: SqliteDraftRow[][] = [];
  private valid = true; private unknown = false; private input = false; private disposed = false; private snapshotReleased = false; private message = ''; private previewValue?: SqliteTableEditPreview; private operation?: Operation;
  constructor(readonly page: SqliteTablePage, private readonly ports: Ports) {
    const edit = page.edit;
    if (edit?.kind !== 'editable' || !edit.snapshotId || !Number.isFinite(Date.parse(edit.expiresAt)) || edit.columns.length !== page.columns.length || edit.rows.length !== page.result.rows.length || edit.columns.some((column, i) => column.name !== page.columns[i].name) || edit.rows.some(row => row.length !== edit.columns.length)) throw Error(text.invalid);
    this.rows = edit.rows.map((values, index) => ({ id: 'original-' + index, index, values: structuredClone(values), deleted: false }));
  }
  /** 任何失效观察留下墓碑，恢复相同引用或版本也不会复活提交资格。 */
  observe(): void {
    if (this.disposed) return;
    if (this.valid && (!this.ports.current() || this.operation?.lease && !this.operation.acquiring && !this.operation.lease.owns())) { this.valid = false; this.message = text.stale; this.invalidatePreview(); this.stop(); this.emit(); }
    if (this.valid && !this.busy && this.page.edit?.kind === 'editable' && this.ports.now() >= Date.parse(this.page.edit.expiresAt)) { this.valid = false; this.message = text.expired; this.invalidatePreview(); this.emit(); }
  }
  get changes(): SqliteTableChange[] { return sqliteDraftChanges(this.page, this.rows); }
  get dirty(): boolean { return this.input || this.changes.length > 0 || this.unknown; }
  get busy(): boolean { return !!this.operation; }
  get view(): SqliteEditView { return { page: this.page, rows: this.rows, dirty: this.dirty, busy: this.busy, valid: this.valid && !this.disposed, unknown: this.unknown, undo: !!this.past.length, redo: !!this.future.length, message: this.message, preview: this.previewValue, taskId: this.operation?.id }; }
  private emit(): void { if (!this.disposed) { this.ports.dirty(this.dirty || this.busy); this.ports.changed(this.view); } }
  /** 快照释放失败只报告，不认领或释放任何其它来源。 */
  private release(input: { snapshotId?: string; previewId?: string }): void { void this.ports.release(input).catch(reason => { if (!this.disposed) { this.message = String(reason instanceof Error ? reason.message : reason); this.emit(); } }); }
  /** 同一已接管快照只释放一次，严格模式或重复关闭不重复投递释放请求。 */
  private releaseSnapshot(): void { if (!this.snapshotReleased && this.page.edit?.kind === 'editable') { this.snapshotReleased = true; this.release({ snapshotId: this.page.edit.snapshotId }); } }
  private invalidatePreview(): void { const preview = this.previewValue; this.previewValue = undefined; if (preview) this.release({ previewId: preview.previewId }); }
  /** 只有当前活动源且没有作业时允许编辑；失效草稿仍可查看和明确放弃。 */
  canEdit(): boolean { this.observe(); return this.valid && !this.unknown && !this.disposed && !this.busy && this.ports.active() && this.ports.available(); }
  inputOpen(value: boolean): void { if (!this.busy) { this.input = value; this.emit(); } }
  /** 每次本地修改形成一个撤销步骤，并同步废弃旧 SQL 预览。 */
  private replace(rows: SqliteDraftRow[]): void { this.invalidatePreview(); this.past.push(this.rows); this.future = []; this.rows = rows; this.input = false; this.message = ''; this.emit(); }
  add(): string | undefined { if (!this.canEdit()) return; const id = this.ports.id(); this.replace([...this.rows, { id, values: this.page.columns.map(() => undefined), deleted: false }]); return id; }
  /** 多行粘贴仅新增本地草稿；整组与原脏修改通过原预算后才分配ID并一次发布/形成一步undo。 */
  appendRows(values: readonly (readonly (SqliteOriginalValue | undefined)[])[]): string[] {
    if (!this.canEdit() || this.page.edit?.kind !== 'editable') throw Error(this.message || text.stale);
    const edit = this.page.edit, width = this.page.columns.length, original = this.rows, past = this.past, pastLength = past.length, future = this.future, preview = this.previewValue, snapshotId = edit.snapshotId, schemaKey = this.page.schemaKey;
    if (!width || width > 1024 || edit.columns.length !== width || edit.columns.some((column, index) => column.name !== this.page.columns[index].name)) throw Error(text.invalid);
    const matrix = appendArray(values, 1, sqliteTableEditLimits.changes), sources: (readonly unknown[])[] = [];
    // 生成/DEFAULT槽仍须存在且为undefined，最多500x1024槽；全组结构先验完再读typed值。
    for (let index = 0; index < matrix.length; index++) sources.push(appendArray(Object.getOwnPropertyDescriptor(matrix, String(index))!.value, width, width));
    const existing = this.changes; if (existing.length + sources.length > sqliteTableEditLimits.changes) throw Error(text.invalid);
    let cells = 0, units = 0; const account = (column: string, value: Record<string, unknown>) => { cells++; units += column.length + (typeof value.value === 'string' ? value.value.length : 0); if (cells > sqliteTableEditLimits.cells || units > sqliteTableEditLimits.inputUnits) throw Error(text.invalid); };
    for (const change of existing) if (change.kind !== 'delete') for (const field of change.values) account(field.column, field.value);
    const copied: (SqliteOriginalValue | undefined)[][] = [], inserts: SqliteTableChange[] = [];
    for (const source of sources) {
      const row: (SqliteOriginalValue | undefined)[] = [], fields: { column: string; value: ReturnType<typeof sqliteEditValueSchema.parse> }[] = [];
      for (let index = 0; index < width; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(source, String(index)); if (!descriptor?.enumerable || !('value' in descriptor)) throw Error(text.invalid); const value: unknown = descriptor.value, column = edit.columns[index];
        if (value === undefined) { row.push(undefined); continue; } if (column.generated) throw Error(text.invalid);
        const plain = appendValue(value); account(column.name, plain); const parsed = sqliteEditValueSchema.parse(plain); row.push(parsed); fields.push({ column: column.name, value: parsed });
      }
      copied.push(row); inserts.push({ kind: 'insert', values: fields });
    }
    sqliteTableEditPreviewSchema.parse({ snapshotId, taskId: 'sqlite-append-validation', changes: [...existing, ...inserts] });
    const current = () => { if (!this.canEdit() || this.page.edit !== edit || edit.snapshotId !== snapshotId || this.page.schemaKey !== schemaKey || this.rows !== original || this.past !== past || past.length !== pastLength || this.future !== future || this.previewValue !== preview) throw Error(this.message || text.stale); };
    current(); const used = new Set<string>(); for (const row of original) { if (typeof row.id !== 'string' || !row.id.length || used.has(row.id)) throw Error(text.invalid); used.add(row.id); }
    const ids: string[] = []; for (const _row of copied) { const id = this.ports.id(); if (typeof id !== 'string' || !id.length || used.has(id)) throw Error(text.invalid); used.add(id); ids.push(id); }
    current(); this.replace([...original, ...copied.map((row, index) => ({ id: ids[index], values: row, deleted: false }))]); return ids;
  }
  save(rowId: string, values: (SqliteOriginalValue | undefined)[]): void {
    if (!this.canEdit() || this.page.edit?.kind !== 'editable') return;
    const row = this.rows.find(row => row.id === rowId); if (!row || row.deleted || values.length !== this.page.edit.columns.length) return;
    const next = values.map((value, i) => this.page.edit?.kind === 'editable' && this.page.edit.columns[i].generated ? row.values[i] : JSON.stringify(value) === JSON.stringify(row.values[i]) ? value : value === undefined && row.index === undefined ? undefined : sqliteEditValueSchema.parse(value));
    this.replace(this.rows.map(item => item === row ? { ...row, values: structuredClone(next) } : item));
  }
  remove(id: string): void { if (this.canEdit()) this.replace(this.rows.flatMap(row => row.id !== id ? [row] : row.index === undefined ? [] : [{ ...row, deleted: true }])); }
  undo(): void { if (!this.canEdit() || !this.past.length) return; this.invalidatePreview(); this.future.push(this.rows); this.rows = this.past.pop()!; this.emit(); }
  redo(): void { if (!this.canEdit() || !this.future.length) return; this.invalidatePreview(); this.past.push(this.rows); this.rows = this.future.pop()!; this.emit(); }
  /** 明确放弃只处理本地草稿；未知提交仍不可重放，必须重新读取新快照。 */
  discard(): void { if (this.busy) return; this.invalidatePreview(); this.rows = this.page.edit?.kind === 'editable' ? this.page.edit.rows.map((values, index) => ({ id: 'original-' + index, index, values: structuredClone(values), deleted: false })) : []; this.past = []; this.future = []; this.input = false; this.unknown = false; this.emit(); }
  closePreview(): void { if (!this.busy) { this.invalidatePreview(); this.emit(); } }
  /** 自有租约获得期间接受同步 store 通知；其它作业接管后永久失效。 */
  private begin(kind: Operation['kind']): Operation {
    if (!this.canEdit() || this.input) throw Error(this.message || text.stale);
    const op: Operation = { id: this.ports.id(), kind, acquiring: true, sent: false, cancelled: false }; this.operation = op;
    try { op.lease = this.ports.acquire(); op.acquiring = false; this.observe(); if (!this.valid || !op.lease.owns()) throw Error(text.stale); this.emit(); return op; }
    catch (reason) { this.operation = undefined; op.lease?.release(); this.emit(); throw reason; }
  }
  private async end(op: Operation): Promise<void> {
    let observed: Promise<unknown> | undefined;
    do { observed = op.cancel; if (observed) await observed.catch(() => {}); } while (observed !== op.cancel);
    if (this.operation === op) this.operation = undefined; op.lease?.release(); this.emit();
    if (this.disposed) { this.invalidatePreview(); this.releaseSnapshot(); }
  }
  /** 预览只发送准确 snapshot 和 typed 差异；迟到预览必须释放，不能挂在新草稿上。 */
  async preview(): Promise<void> {
    let op: Operation | undefined;
    try {
      const changes = this.changes; if (!changes.length || this.page.edit?.kind !== 'editable') return;
      const input = sqliteTableEditPreviewSchema.parse({ snapshotId: this.page.edit.snapshotId, taskId: this.ports.id(), changes });
      this.invalidatePreview(); op = this.begin('preview'); input.taskId = op.id; op.sent = true;
      const preview = await this.ports.preview(input); this.observe();
      if (!this.valid || this.disposed || this.operation !== op || op.cancelled) { this.release({ previewId: preview.previewId }); return; }
      if (preview.snapshotId !== this.page.edit.snapshotId || preview.target.connectionId !== this.page.target.connectionId || preview.target.database !== 'main' || preview.target.table !== this.page.target.table || preview.schemaKey !== this.page.schemaKey || !Number.isFinite(Date.parse(preview.expiresAt))) { this.release({ previewId: preview.previewId }); throw Error(text.invalid); }
      this.previewValue = preview; this.message = '';
    } catch (reason) { this.message = String(reason instanceof Error ? reason.message : reason); }
    finally { if (op) await this.end(op); else this.emit(); }
  }
  /** 明确提交消费本次预览；未知或断包锁定原批次，成功事实不被刷新失败覆盖。 */
  async apply(): Promise<void> {
    const preview = this.previewValue; if (!preview) return;
    let op: Operation | undefined, sent = false;
    try {
      if (this.ports.now() >= Date.parse(preview.expiresAt)) { this.invalidatePreview(); throw Error(text.expired); }
      op = this.begin('apply'); this.previewValue = undefined; op.sent = true; sent = true; this.emit();
      const result = await this.ports.apply({ previewId: preview.previewId, taskId: op.id, confirmation: preview.confirmation });
      if (result.target.connectionId !== this.page.target.connectionId || result.target.database !== 'main' || result.target.table !== this.page.target.table || !['committed', 'rolled-back', 'not-sent', 'unknown'].includes(result.outcome) || result.outcome === 'committed' && !result.fact.commitAcknowledged) throw Error(text.invalid);
      this.message = result.message;
      if (result.outcome === 'committed') { this.rows = []; this.past = []; this.future = []; this.input = false; this.valid = false; this.unknown = false; }
      else if (result.outcome === 'unknown') { this.unknown = true; this.valid = false; this.message = text.unknown; }
      if (result.outcome === 'committed') { await this.end(op); op = undefined; if (!this.disposed) { try { this.ports.committed(); } catch { /* 刷新或通知异常不能改写真实提交成功。 */ } } }
    } catch (reason) { this.message = sent ? text.unknown + ' ' + String(reason instanceof Error ? reason.message : reason) : String(reason instanceof Error ? reason.message : reason); if (sent) { this.unknown = true; this.valid = false; } }
    finally { if (op) await this.end(op); else this.emit(); }
  }
  /** 仅取消本 controller 的原任务；ACK 后仍由原 Promise 的 finally 释放占用。 */
  stop(): void { const op = this.operation; if (op?.sent && !op.cancel) { op.cancelled = true; if (op.kind === 'preview' && this.valid) this.message = text.stopped; op.cancel = this.ports.cancel(op.id).catch(reason => { this.message = String(reason instanceof Error ? reason.message : reason); this.emit(); }); } }
  /** 卸载不释放已发送提交的预览；原提交仍沿自身 Promise 结算真实事实。 */
  dispose(): void { this.disposed = true; this.valid = false; if (!this.busy) { this.invalidatePreview(); this.releaseSnapshot(); } }
}
