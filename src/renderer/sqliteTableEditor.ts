import type { SqliteEditBatch } from './sqliteEditWorkspace';
import type { SqliteTablePage } from '../shared/sqliteTableBrowse';
import { sqliteEditValueSchema, sqliteTableEditPreviewSchema, sqliteTableEditLimits, type SqliteOriginalValue, type SqliteTableChange, type SqliteTableEditPreview, type SqliteTableEditOutcome } from '../shared/sqliteTableEdit';
import { sqliteTableEditZh as text } from './locales/sqliteTableEdit.zh-CN';
import { prepareSqliteFill, sqliteFillSourceCurrent, type SqliteFillField, type SqliteFillSource } from './sqliteTableFill';

export interface SqliteDraftRow { id: string; index?: number; values: (SqliteOriginalValue | undefined)[]; deleted: boolean; }
export interface SqliteEditView { page: SqliteTablePage; rows: SqliteDraftRow[]; dirty: boolean; busy: boolean; valid: boolean; unknown: boolean; undo: boolean; redo: boolean; message: string; preview?: SqliteTableEditPreview; taskId?: string; }
interface Lease { owns(): boolean; release(): boolean; }
interface Ports { batch?(): SqliteEditBatch | undefined; settled?(outcome: SqliteTableEditOutcome['outcome']): void; current(): boolean; active(): boolean; available(): boolean; acquire(): Lease; id(): string; now(): number; changed(view: SqliteEditView): void; dirty(value: boolean): void; preview(input: { snapshotId: string; taskId: string; changes: SqliteTableChange[] }): Promise<SqliteTableEditPreview>; apply(input: { previewId: string; taskId: string; confirmation: string }): Promise<SqliteTableEditOutcome>; release(input: { snapshotId?: string; previewId?: string }): Promise<unknown>; cancel(taskId: string): Promise<unknown>; committed(): void; }
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
/** 本地格值按显式动态类型和原文字串比较，不让对象属性顺序制造一次虚假修改。 */
function sameDraftValue(left: SqliteOriginalValue | undefined, right: SqliteOriginalValue | undefined): boolean { return left === undefined || right === undefined ? left === right : left.kind === right.kind && (left.kind === 'null' || right.kind !== 'null' && left.value === right.value); }
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
  private generationValue: object = {};
  /** 记录每次可观察编辑状态变代，撤销/重做恢复原数组也不复活旧模板预览。 */
  get generation(): object { return this.generationValue; }
  private rows: SqliteDraftRow[]; private past: SqliteDraftRow[][] = []; private future: SqliteDraftRow[][] = [];
  private valid = true; private unknown = false; private input = false; private disposed = false; private snapshotReleased = false; private message = ''; private previewValue?: SqliteTableEditPreview; private batchCurrent?: () => boolean; private operation?: Operation;
  constructor(readonly page: SqliteTablePage, private readonly ports: Ports) {
    const edit = page.edit;
    if (edit?.kind !== 'editable' || !edit.snapshotId || !Number.isFinite(Date.parse(edit.expiresAt)) || edit.columns.length !== page.columns.length || edit.rows.length !== page.result.rows.length || edit.columns.some((column, i) => column.name !== page.columns[i].name) || edit.rows.some(row => row.length !== edit.columns.length)) throw Error(text.invalid);
    this.rows = edit.rows.map((values, index) => ({ id: 'original-' + index, index, values: structuredClone(values), deleted: false }));
  }
  /** 任何失效观察留下墓碑，恢复相同引用或版本也不会复活提交资格。 */
  observe(): void {
    if (this.disposed) return;
    if (this.previewValue && this.batchCurrent && !this.batchCurrent()) { this.invalidatePreview(); this.message = text.stale; this.emit(); }
    if (this.valid && (!this.ports.current() || this.operation?.lease && !this.operation.acquiring && !this.operation.lease.owns())) { this.valid = false; this.message = text.stale; this.invalidatePreview(); this.stop(); this.emit(); }
    if (this.valid && !this.busy && this.page.edit?.kind === 'editable' && this.ports.now() >= Date.parse(this.page.edit.expiresAt)) { this.valid = false; this.message = text.expired; this.invalidatePreview(); this.emit(); }
  }
  get hasInput(): boolean { return this.input; }
  get changes(): SqliteTableChange[] { return sqliteDraftChanges(this.page, this.rows); }
  get dirty(): boolean { return this.input || this.changes.length > 0 || this.unknown; }
  get busy(): boolean { return !!this.operation; }
  get view(): SqliteEditView { return { page: this.page, rows: this.rows, dirty: this.dirty, busy: this.busy, valid: this.valid && !this.disposed, unknown: this.unknown, undo: !!this.past.length, redo: !!this.future.length, message: this.message, preview: this.previewValue, taskId: this.operation?.id }; }
  private emit(): void { if (!this.disposed) { this.generationValue = {}; this.ports.dirty(this.dirty || this.busy); this.ports.changed(this.view); } }
  /** 快照释放失败只报告，不认领或释放任何其它来源。 */
  private release(input: { snapshotId?: string; previewId?: string }): void { void this.ports.release(input).catch(reason => { if (!this.disposed) { this.message = String(reason instanceof Error ? reason.message : reason); this.emit(); } }); }
  /** 同一已接管快照只释放一次，严格模式或重复关闭不重复投递释放请求。 */
  private releaseSnapshot(): void { if (!this.snapshotReleased && this.page.edit?.kind === 'editable') { this.snapshotReleased = true; this.release({ snapshotId: this.page.edit.snapshotId }); } }
  private invalidatePreview(): void { const preview = this.previewValue; this.previewValue = undefined; this.batchCurrent = undefined; if (preview) this.release({ previewId: preview.previewId }); }
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
  /** 连续矩形只替换已有可见草稿格；全组后状态通过原预算才一次发布，不补行/跳列/分配ID或写DB。 */
  pasteCells(rowId: string, column: number, values: readonly (readonly (SqliteOriginalValue | undefined)[])[], columnIndices?: readonly number[]): number {
    if (!this.canEdit() || this.page.edit?.kind !== 'editable') throw Error(this.message || text.stale);
    const edit = this.page.edit, original = this.rows, past = this.past, pastLength = past.length, future = this.future, futureLength = future.length, preview = this.previewValue, snapshotId = edit.snapshotId, schemaKey = this.page.schemaKey, width = this.page.columns.length;
    if (typeof rowId !== 'string' || !rowId.length || !Number.isInteger(column) || column < 0 || column >= width || !width || width > 1024 || edit.columns.length !== width || edit.columns.some((item, index) => item.name !== this.page.columns[index].name || item.generated !== !!this.page.columns[index].generated)) throw Error(text.invalid);
    // 显示顺序只映射到原字段编号；行数组、生成列及累计预算仍沿原路径核对。
    const mapping = columnIndices === undefined ? Array.from({ length: width - column }, (_, offset) => column + offset) : appendArray(columnIndices, 1, width).map((_, index) => Object.getOwnPropertyDescriptor(columnIndices, String(index))!.value as number);
    if (mapping[0] !== column || new Set(mapping).size !== mapping.length || mapping.some(index => !Number.isInteger(index) || index < 0 || index >= width)) throw Error(text.invalid);
    const signature = JSON.stringify([edit.snapshotId, edit.expiresAt, edit.columns, this.page.columns]), current = () => { if (!this.canEdit() || this.page.edit !== edit || edit.snapshotId !== snapshotId || this.page.schemaKey !== schemaKey || JSON.stringify([edit.snapshotId, edit.expiresAt, edit.columns, this.page.columns]) !== signature || this.rows !== original || this.past !== past || past.length !== pastLength || this.future !== future || future.length !== futureLength || this.previewValue !== preview) throw Error(this.message || text.stale); };
    const ids = new Set<string>(); for (const row of original) { if (typeof row.id !== 'string' || !row.id.length || ids.has(row.id)) throw Error(text.invalid); ids.add(row.id); }
    const start = original.findIndex(row => row.id === rowId); if (start < 0) throw Error(text.invalid);
    const matrix = appendArray(values, 1, sqliteTableEditLimits.changes), sources: (readonly unknown[])[] = []; let rangeWidth: number | undefined;
    if (start + matrix.length > original.length) throw Error(text.invalid);
    // 逻辑格数包含DEFAULT；先核完整结构和连续目标，不在未知输入上分配或跨生成列平移。
    for (let index = 0; index < matrix.length; index++) { const row = appendArray(Object.getOwnPropertyDescriptor(matrix, String(index))!.value, 1, mapping.length); if (rangeWidth !== undefined && row.length !== rangeWidth) throw Error(text.invalid); rangeWidth = row.length; if (matrix.length * rangeWidth > sqliteTableEditLimits.cells) throw Error(text.invalid); sources.push(row); }
    for (let index = 0; index < sources.length; index++) { const row = original[start + index]; if (row.deleted || row.values.length !== width || row.index !== undefined && (!Number.isInteger(row.index) || row.index < 0 || row.index >= edit.rows.length)) throw Error(text.invalid); }
    for (const index of mapping.slice(0, rangeWidth)) if (edit.columns[index].generated) throw Error(text.invalid);
    current(); const next = [...original]; let changedCells = 0, units = 0;
    for (let rowIndex = 0; rowIndex < sources.length; rowIndex++) {
      const row = original[start + rowIndex]; let changedValues: (SqliteOriginalValue | undefined)[] | undefined;
      for (let offset = 0; offset < rangeWidth!; offset++) {
        const descriptor = Object.getOwnPropertyDescriptor(sources[rowIndex], String(offset)); if (!descriptor?.enumerable || !('value' in descriptor)) throw Error(text.invalid); const raw: unknown = descriptor.value, target = mapping[offset]; let parsed: SqliteOriginalValue | undefined;
        if (raw === undefined) { if (row.index !== undefined) throw Error(text.invalid); parsed = undefined; }
        else { const plain = appendValue(raw); units += edit.columns[target].name.length + (typeof plain.value === 'string' ? plain.value.length : 0); if (units > sqliteTableEditLimits.inputUnits) throw Error(text.invalid); parsed = sqliteEditValueSchema.parse(plain); }
        if (sameDraftValue(row.values[target], parsed)) continue;
        // 回到准确原值时保其属性次序但隔离引用，真实sqliteDraftChanges才能完整消除旧差异。
        const source = row.index === undefined ? undefined : edit.rows[row.index][target]; if (row.index !== undefined && sameDraftValue(source, parsed)) parsed = structuredClone(source);
        if (!changedValues) changedValues = [...row.values]; changedValues[target] = parsed; changedCells++;
      }
      if (changedValues) next[start + rowIndex] = { ...row, values: changedValues };
    }
    const changes = sqliteDraftChanges(this.page, next); if (changes.length) sqliteTableEditPreviewSchema.parse({ snapshotId, taskId: 'sqlite-range-paste-validation', changes });
    current(); if (!changedCells) return 0; this.replace(next); return changedCells;
  }
  /** 查找替换只暂存准确before的TEXT格；全组及最终草稿预算通过后一次发布，任何失败不产生半批修改。 */
  replaceTextCells(patches: readonly { rowId: string; column: number; before: string; after: string }[]): number {
    if (!this.canEdit() || this.page.edit?.kind !== 'editable') throw Error(this.message || text.stale);
    const edit = this.page.edit, original = this.rows, past = this.past, pastLength = past.length, future = this.future, futureLength = future.length, preview = this.previewValue, snapshotId = edit.snapshotId, schemaKey = this.page.schemaKey, width = this.page.columns.length;
    if (!width || width > 1024 || edit.columns.length !== width || edit.columns.some((item, index) => item.name !== this.page.columns[index].name || item.generated !== !!this.page.columns[index].generated)) throw Error(text.invalid);
    const signature = JSON.stringify([edit.snapshotId, edit.expiresAt, edit.columns, this.page.columns]);
    const current = () => { if (!this.canEdit() || this.page.edit !== edit || edit.snapshotId !== snapshotId || this.page.schemaKey !== schemaKey || JSON.stringify([edit.snapshotId, edit.expiresAt, edit.columns, this.page.columns]) !== signature || this.rows !== original || this.past !== past || past.length !== pastLength || this.future !== future || future.length !== futureLength || this.previewValue !== preview) throw Error(this.message || text.stale); };
    const input = appendArray(patches, 1, sqliteTableEditLimits.cells), rows = new Map<string, number>();
    for (let index = 0; index < original.length; index++) { const row = original[index]; if (typeof row.id !== 'string' || !row.id.length || rows.has(row.id)) throw Error(text.invalid); rows.set(row.id, index); }
    const copied: { index: number; column: number; before: string; after: string }[] = [], coordinates = new Set<string>(); let units = 0;
    for (let index = 0; index < input.length; index++) {
      const raw: unknown = Object.getOwnPropertyDescriptor(input, String(index))!.value;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) || ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) throw Error(text.invalid);
      const names = ['rowId', 'column', 'before', 'after'] as const, keys = Reflect.ownKeys(raw); if (keys.length !== names.length || keys.some(key => typeof key !== 'string' || !names.includes(key as typeof names[number]))) throw Error(text.invalid);
      const values = Object.create(null) as Record<typeof names[number], unknown>;
      for (const name of names) { const field = Object.getOwnPropertyDescriptor(raw, name); if (!field?.enumerable || !('value' in field)) throw Error(text.invalid); values[name] = field.value; }
      const { rowId, column, before, after } = values;
      if (typeof rowId !== 'string' || !rowId.length || typeof column !== 'number' || !Number.isInteger(column) || column < 0 || column >= width || typeof before !== 'string' || typeof after !== 'string') throw Error(text.invalid);
      const position = rows.get(rowId); if (position === undefined) throw Error(text.invalid); const row = original[position], cell = row.values[column], coordinate = position + ':' + column;
      if (coordinates.has(coordinate) || row.deleted || row.values.length !== width || row.index !== undefined && (!Number.isInteger(row.index) || row.index < 0 || row.index >= edit.rows.length) || edit.columns[column].generated || cell?.kind !== 'text' || cell.value !== before) throw Error(text.invalid);
      coordinates.add(coordinate);
      // 原TEXT可能大于新输入门；noop原样保留，缩短替换只对新after计预算，不能拒绝合法的大原文来源。
      if (before !== after) { units += edit.columns[column].name.length + after.length; if (after.length > sqliteTableEditLimits.valueUnits || units > sqliteTableEditLimits.inputUnits) throw Error(text.invalid); sqliteEditValueSchema.parse({ kind: 'text', value: after }); }
      copied.push({ index: position, column, before, after });
    }
    current(); const next = [...original]; let changedCells = 0;
    for (const patch of copied) {
      if (patch.before === patch.after) continue;
      const row = original[patch.index], source = row.index === undefined ? undefined : edit.rows[row.index][patch.column], value = source?.kind === 'text' && source.value === patch.after ? structuredClone(source) : { kind: 'text' as const, value: patch.after };
      if (next[patch.index] === row) next[patch.index] = { ...row, values: [...row.values] };
      next[patch.index].values[patch.column] = value; changedCells++;
    }
    current(); if (!changedCells) return 0;
    const changes = sqliteDraftChanges(this.page, next); if (changes.length) sqliteTableEditPreviewSchema.parse({ snapshotId, taskId: 'sqlite-text-replace-validation', changes });
    current(); this.replace(next); return changedCells;
  }
  save(rowId: string, values: (SqliteOriginalValue | undefined)[]): void {
    if (!this.canEdit() || this.page.edit?.kind !== 'editable') return;
    const row = this.rows.find(row => row.id === rowId); if (!row || row.deleted || values.length !== this.page.edit.columns.length) return;
    const next = values.map((value, i) => this.page.edit?.kind === 'editable' && this.page.edit.columns[i].generated ? row.values[i] : JSON.stringify(value) === JSON.stringify(row.values[i]) ? value : value === undefined && row.index === undefined ? undefined : sqliteEditValueSchema.parse(value));
    this.replace(this.rows.map(item => item === row ? { ...row, values: structuredClone(next) } : item));
  }
  remove(id: string): void { if (this.canEdit()) this.replace(this.rows.flatMap(row => row.id !== id ? [row] : row.index === undefined ? [] : [{ ...row, deleted: true }])); }
  /** 勾选删除仅改变本地草稿；整批及最终累计预算通过后形成一个撤销步骤，不分配ID或发送任务。 */
  removeRows(ids: readonly string[]): number {
    if (!this.canEdit() || this.input || this.page.edit?.kind !== 'editable') throw Error(this.message || text.stale);
    const edit = this.page.edit, original = this.rows, past = this.past, pastLength = past.length, future = this.future, futureLength = future.length, preview = this.previewValue, snapshotId = edit.snapshotId, schemaKey = this.page.schemaKey;
    const width = this.page.columns.length;
    if (!width || width > 1024 || edit.columns.length !== width || edit.columns.some((item, index) => item.name !== this.page.columns[index].name || item.generated !== !!this.page.columns[index].generated)) throw Error(text.invalid);
    // 同步端口也可能触发来源交接；除数组身份外核对完整before，不能把重入修改混入这次删除。
    const sourceRows = edit.rows, metadata = JSON.stringify([this.page.target, edit.snapshotId, edit.expiresAt, edit.columns, this.page.columns, edit.locator]);
    const before = JSON.stringify([original, edit.rows]), rowRefs = original.map(row => ({ row, values: row.values }));
    const current = () => {
      if (!this.canEdit() || this.input || this.page.edit !== edit || edit.rows !== sourceRows || edit.snapshotId !== snapshotId || this.page.schemaKey !== schemaKey || this.rows !== original || this.past !== past || past.length !== pastLength || this.future !== future || future.length !== futureLength || this.previewValue !== preview || JSON.stringify([this.page.target, edit.snapshotId, edit.expiresAt, edit.columns, this.page.columns, edit.locator]) !== metadata || JSON.stringify([original, edit.rows]) !== before || original.length !== rowRefs.length || rowRefs.some((item, index) => original[index] !== item.row || item.row.values !== item.values)) throw Error(this.message || text.stale);
    };
    const requested = appendArray(ids, 0, 1500), selected = new Set<string>(), byId = new Map<string, SqliteDraftRow>();
    for (const row of original) {
      if (typeof row.id !== 'string' || !row.id.length || byId.has(row.id)) throw Error(text.invalid);
      byId.set(row.id, row);
    }
    for (let index = 0; index < requested.length; index++) {
      const id: unknown = Object.getOwnPropertyDescriptor(requested, String(index))!.value;
      if (typeof id !== 'string' || !id.length || selected.has(id)) throw Error(text.invalid);
      const row = byId.get(id);
      if (!row || row.deleted || row.values.length !== width || row.index !== undefined && (!Number.isInteger(row.index) || row.index < 0 || row.index >= edit.rows.length)) throw Error(text.invalid);
      selected.add(id);
    }
    current(); if (!selected.size) return 0;
    const next = original.flatMap(row => !selected.has(row.id) ? [row] : row.index === undefined ? [] : [{ ...row, deleted: true }]);
    // 删除本地新增可令最终changes为空；原schema的min(1)只在确有最终修改时适用。
    const changes = sqliteDraftChanges(this.page, next);
    if (changes.length && !sqliteTableEditPreviewSchema.safeParse({ snapshotId, taskId: 'sqlite-remove-selected-validation', changes }).success) throw Error(text.bulkDeleteLimit);
    current(); this.replace(next); return selected.size;
  }
  /** 多字段统一填充只暂存当前准确勾选行；整批校验后一次发布，同值不清预览或消耗undo。 */
  fillRows(rowIds: readonly string[], fields: readonly SqliteFillField[]): number {
    if (!this.canEdit() || this.page.edit?.kind !== 'editable') throw Error(this.message || text.stale);
    const ids = appendArray(rowIds, 0, 1500), rawFields = appendArray(fields, 0, 1024);
    // 完整扇出先界定再读取来源或typed值；空请求不签能力、不发布状态，也不消耗原预览。
    if (ids.length * rawFields.length > sqliteTableEditLimits.cells) throw Error(text.invalid);
    if (!ids.length || !rawFields.length) return 0;
    const edit = this.page.edit, original = this.rows, past = this.past, pastLength = past.length, future = this.future, futureLength = future.length, preview = this.previewValue, input = this.input, baseline = edit.rows, snapshotId = edit.snapshotId, width = this.page.columns.length;
    appendArray(original, 0, 1500);
    const liveRow = original.find(row => Object.getOwnPropertyDescriptor(row, 'deleted')?.value === false); if (!liveRow) throw Error(text.invalid);
    const source: SqliteFillSource = prepareSqliteFill(this.page, original, [liveRow]);
    // source先证明自有data，再读取row/values引用，禁止校验前触发来源中的getter。
    const signature = JSON.stringify([this.page.target, this.page.schemaKey, edit.snapshotId, edit.expiresAt, this.page.columns, edit.columns, edit.locator]), rowRefs = original.map(row => ({ row, values: row.values }));
    const current = () => { if (!this.canEdit() || this.page.edit !== edit || edit.rows !== baseline || edit.snapshotId !== snapshotId || this.rows !== original || this.past !== past || past.length !== pastLength || this.future !== future || future.length !== futureLength || this.previewValue !== preview || this.input !== input || JSON.stringify([this.page.target, this.page.schemaKey, edit.snapshotId, edit.expiresAt, this.page.columns, edit.columns, edit.locator]) !== signature || original.length !== rowRefs.length || rowRefs.some((item, index) => original[index] !== item.row || item.row.values !== item.values) || source && !sqliteFillSourceCurrent(source, this.page, original)) throw Error(this.message || text.stale); };
    const rows = new Map<string, SqliteDraftRow>(), selected = new Set<string>();
    for (const row of original) { if (typeof row.id !== 'string' || !row.id || rows.has(row.id)) throw Error(text.invalid); rows.set(row.id, row); }
    for (let i = 0; i < ids.length; i++) { const id: unknown = Object.getOwnPropertyDescriptor(ids, String(i))!.value; if (typeof id !== 'string' || !id || selected.has(id) || !rows.has(id) || rows.get(id)!.deleted) throw Error(text.invalid); selected.add(id); }
    const targets = original.filter(row => selected.has(row.id)), allNew = targets.every(row => row.index === undefined), columns = new Set<number>(), copied: SqliteFillField[] = []; let units = 0;
    for (let i = 0; i < rawFields.length; i++) {
      const raw: unknown = Object.getOwnPropertyDescriptor(rawFields, String(i))!.value;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) || ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) throw Error(text.invalid);
      const keys = Reflect.ownKeys(raw); if (keys.length !== 2 || !keys.includes('column') || !keys.includes('value')) throw Error(text.invalid);
      const columnField = Object.getOwnPropertyDescriptor(raw, 'column'), valueField = Object.getOwnPropertyDescriptor(raw, 'value'); if (!columnField?.enumerable || !('value' in columnField) || !valueField?.enumerable || !('value' in valueField)) throw Error(text.invalid);
      const column: unknown = columnField.value, value: unknown = valueField.value;
      if (typeof column !== 'number' || !Number.isInteger(column) || column < 0 || column >= width || columns.has(column) || edit.columns[column].generated || value === undefined && !allNew) throw Error(text.invalid);
      columns.add(column); const plain = value === undefined ? undefined : appendValue(value);
      units += edit.columns[column].name.length + (typeof plain?.value === 'string' ? plain.value.length : 0); if (units > sqliteTableEditLimits.inputUnits) throw Error(text.invalid);
      copied.push({ column, value: plain === undefined ? undefined : sqliteEditValueSchema.parse(plain) });
    }
    current(); if (!targets.length || !copied.length) return 0;
    const next = [...original]; let changedCells = 0;
    for (let index = 0; index < original.length; index++) {
      const row = original[index]; if (!selected.has(row.id)) continue;
      for (const field of copied) {
        if (sameDraftValue(row.values[field.column], field.value)) continue;
        if (next[index] === row) next[index] = { ...row, values: [...row.values] };
        const before = row.index === undefined ? undefined : edit.rows[row.index][field.column];
        // 恢复原值时保原属性序，避免sqliteDraftChanges把等值对象误当成一次更新。
        next[index].values[field.column] = sameDraftValue(before, field.value) ? before === undefined ? undefined : structuredClone(before) : field.value === undefined ? undefined : { ...field.value };
        changedCells++;
      }
    }
    current(); if (!changedCells) return 0;
    const changes = sqliteDraftChanges(this.page, next); if (changes.length) sqliteTableEditPreviewSchema.parse({ snapshotId, taskId: 'sqlite-fill-validation', changes });
    current(); this.replace(next); return changedCells;
  }
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
      const batch = this.ports.batch?.(), changes = this.changes;
      if ((!batch && !changes.length) || this.page.edit?.kind !== 'editable') return;
      const input = sqliteTableEditPreviewSchema.parse({ ...(batch?.input ?? { snapshotId: this.page.edit.snapshotId, changes }), taskId: this.ports.id() });
      const ids = [input.snapshotId, ...(input.additionalPages ?? []).map(page => page.snapshotId)];
      this.invalidatePreview(); op = this.begin('preview'); input.taskId = op.id; op.sent = true;
      const preview = await this.ports.preview(input); this.observe();
      if (!this.valid || this.disposed || this.operation !== op || op.cancelled || batch && !batch.current()) { if (batch && !batch.current()) this.message = text.stale; this.release({ previewId: preview.previewId }); return; }
      if (preview.snapshotId !== input.snapshotId || (preview.snapshotIds ?? [preview.snapshotId]).length !== ids.length || (preview.snapshotIds ?? [preview.snapshotId]).some((id, index) => id !== ids[index]) || preview.target.connectionId !== this.page.target.connectionId || preview.target.database !== 'main' || preview.target.table !== this.page.target.table || preview.schemaKey !== this.page.schemaKey || !Number.isFinite(Date.parse(preview.expiresAt))) { this.release({ previewId: preview.previewId }); throw Error(text.invalid); }
      this.previewValue = preview; this.batchCurrent = batch?.current; this.message = '';
    } catch (reason) { this.message = String(reason instanceof Error ? reason.message : reason); }
    finally { if (op) await this.end(op); else this.emit(); }
  }
  /** 明确提交消费本次预览；未知或断包锁定原批次，成功事实不被刷新失败覆盖。 */
  async apply(): Promise<void> {
    const preview = this.previewValue; if (!preview) return;
    let op: Operation | undefined, sent = false;
    try {
      if (this.batchCurrent && !this.batchCurrent()) { this.invalidatePreview(); throw Error(text.stale); }
      if (this.ports.now() >= Date.parse(preview.expiresAt)) { this.invalidatePreview(); throw Error(text.expired); }
      op = this.begin('apply'); this.previewValue = undefined; this.batchCurrent = undefined; op.sent = true; sent = true; this.emit();
      const result = await this.ports.apply({ previewId: preview.previewId, taskId: op.id, confirmation: preview.confirmation });
      if (result.target.connectionId !== this.page.target.connectionId || result.target.database !== 'main' || result.target.table !== this.page.target.table || !['committed', 'rolled-back', 'not-sent', 'unknown'].includes(result.outcome) || result.outcome === 'committed' && !result.fact.commitAcknowledged) throw Error(text.invalid);
      this.message = result.message; this.ports.settled?.(result.outcome);
      if (result.outcome === 'committed') { this.rows = []; this.past = []; this.future = []; this.input = false; this.valid = false; this.unknown = false; }
      else if (result.outcome === 'unknown') { this.unknown = true; this.valid = false; this.message = text.unknown; }
      if (result.outcome === 'committed') { await this.end(op); op = undefined; if (!this.disposed) { try { this.ports.committed(); } catch { /* 刷新或通知异常不能改写真实提交成功。 */ } } }
    } catch (reason) { this.message = sent ? text.unknown + ' ' + String(reason instanceof Error ? reason.message : reason) : String(reason instanceof Error ? reason.message : reason); if (sent) { this.unknown = true; this.valid = false; this.ports.settled?.('unknown'); } }
    finally { if (op) await this.end(op); else this.emit(); }
  }
  /** 仅取消本 controller 的原任务；ACK 后仍由原 Promise 的 finally 释放占用。 */
  stop(): void { const op = this.operation; if (op?.sent && !op.cancel) { op.cancelled = true; if (op.kind === 'preview' && this.valid) this.message = text.stopped; op.cancel = this.ports.cancel(op.id).catch(reason => { this.message = String(reason instanceof Error ? reason.message : reason); this.emit(); }); } }
  /** 卸载不释放已发送提交的预览；原提交仍沿自身 Promise 结算真实事实。 */
  dispose(): void { this.disposed = true; this.valid = false; if (!this.busy) { this.invalidatePreview(); this.releaseSnapshot(); } }
}
