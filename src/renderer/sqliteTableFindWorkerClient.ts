import type { SqliteTablePage } from '../shared/sqliteTableBrowse';
import type { SqliteDraftRow } from './sqliteTableEditor';
import { copySqliteFindTransfer, copySqliteFindOptions, sqliteFindSource, sqliteFindSourceSignature, sqliteFindOccurrences, sqliteFindLimits as limits, sqliteFindMessages as text, type SqliteFindOptions, type SqliteFindMatch, type SqliteFindOccurrence, type SqliteFindSource, type SqliteFindWorkerRequest, type SqliteFindWorkerResult, type SqliteTextPatch } from './sqliteTableFind';

export interface SqliteFindReadyResult { status: 'ready'; matches: SqliteFindMatch[]; occurrences: SqliteFindOccurrence[]; }
export interface SqliteFindBlockedResult { status: 'blocked'; reason: string; message: string; }
export interface SqliteTextReplacementPlan { readonly changedCells: number; readonly changedRows: number; }
export type SqliteFindResult = SqliteFindReadyResult | SqliteFindBlockedResult;
export type SqliteFindPreviewResult = { status: 'ready'; plan: SqliteTextReplacementPlan } | SqliteFindBlockedResult;
export interface SqliteFindWorkerPort { postMessage(value: unknown): void; terminate(): void | Promise<unknown>; onmessage: ((event: MessageEvent) => void) | null; onerror: ((event: ErrorEvent) => void) | null; onmessageerror: ((event: MessageEvent) => void) | null; }
interface Owner { page: SqliteTablePage; rows: readonly SqliteDraftRow[]; rowOwners: { row: SqliteDraftRow; values: SqliteDraftRow['values'] }[]; source: SqliteFindSource; options: SqliteFindOptions; signature: string; valid: boolean; current(): boolean; }
interface Proof { client: SqliteTableFindWorkerClient; owner: Owner; matches: SqliteFindMatch[]; occurrences: SqliteFindOccurrence[]; }
interface PlanProof { owner: Owner; patches: SqliteTextPatch[]; current(): boolean; used: boolean; }
interface Pending { id: number; worker: SqliteFindWorkerPort; request?: SqliteFindWorkerRequest; running: boolean; timer: ReturnType<typeof setTimeout>; resolve(value: SqliteFindWorkerResult): void; }
const searches = new WeakMap<SqliteFindReadyResult, Proof>(), plans = new WeakMap<SqliteTextReplacementPlan, PlanProof>();
const blocked = (reason: string, message: string): SqliteFindBlockedResult => ({ status: 'blocked', reason, message });
/** 全页before按实际kind/value逐格比，不因对象属性顺序制造变化，也不漏掉非替换格变化。 */
function sameSource(left: SqliteFindSource, right: SqliteFindSource): boolean {
  if (left.rows.length !== right.rows.length) return false;
  return left.rows.every((row, index) => { const other = right.rows[index]; return row.id === other.id && row.index === other.index && row.deleted === other.deleted && row.values.length === other.values.length && row.values.every((value, column) => { const next = other.values[column]; return value === undefined || next === undefined ? value === next : value.kind === next.kind && (value.kind === 'null' || next.kind !== 'null' && value.value === next.value); }); });
}
/** 任何观察到的来源失效都留下墓碑；同引用或相同文字恢复后也不复活旧计划。 */
function assertOwner(owner: Owner): void {
  try {
    if (!owner.valid || !owner.current() || owner.rows.length !== owner.rowOwners.length || owner.rows.some((row, index) => row !== owner.rowOwners[index].row || row.values !== owner.rowOwners[index].values)) throw Error(text.stale);
    if (JSON.stringify(copySqliteFindOptions(owner.options, owner.source.columns.length)) !== JSON.stringify(owner.source.options)) throw Error(text.stale);
    const source = sqliteFindSource(owner.page, owner.rows, owner.source.options); if (sqliteFindSourceSignature(owner.page, source) !== owner.signature || !sameSource(owner.source, source)) throw Error(text.stale);
  } catch { owner.valid = false; throw Error(text.stale); }
}
/** 公开对象本身只含冻结摘要；结果外观、旧worker消息或克隆对象都不能签发替换。 */
function assertPlan(plan: SqliteTextReplacementPlan, page: SqliteTablePage, rows: readonly SqliteDraftRow[]): PlanProof { const value = plans.get(plan); if (!value || value.used || value.owner.page !== page || value.owner.rows !== rows || !value.current()) throw Error(text.stale); assertOwner(value.owner); if (!value.owner.source.writable || page.edit?.kind !== 'editable') throw Error(text.readonly); return value; }
/** 预览只复制前10格，完整计数仍由plan给出；不能消费或暴露内部patch数组。 */
export function sqliteTextReplacementPlanPreview(plan: SqliteTextReplacementPlan, page: SqliteTablePage, rows: readonly SqliteDraftRow[]): SqliteTextPatch[] { return assertPlan(plan, page, rows).patches.slice(0, 10).map(patch => ({ ...patch })); }
/** 确认先一次消费原计划再返回全补丁副本，editor仍须校验全量post-patch预算与before。 */
export function sqliteTextReplacementPlanValues(plan: SqliteTextReplacementPlan, page: SqliteTablePage, rows: readonly SqliteDraftRow[]): SqliteTextPatch[] { const value = assertPlan(plan, page, rows); value.used = true; return value.patches.map(patch => ({ ...patch })); }
/** 收到的matches必须落到原source准确格、真实动态类型和完整UTF16区间；非TEXT永不获替换权。 */
function checkedMatches(raw: unknown, source: SqliteFindSource): SqliteFindMatch[] {
  const matches = copySqliteFindTransfer(raw) as SqliteFindMatch[]; if (!Array.isArray(matches) || matches.length > limits.matches) throw Error(text.worker); let prior = -1, occurrences = 0;
  for (const match of matches) {
    if (!match || typeof match !== 'object' || Object.keys(match).sort().join(',') !== 'column,ranges,replaceable,rowId' || typeof match.rowId !== 'string' || !Number.isInteger(match.column) || match.column < 0 || match.column >= source.columns.length || source.options.column !== undefined && match.column !== source.options.column || !Array.isArray(match.ranges) || typeof match.replaceable !== 'boolean') throw Error(text.worker);
    const rowIndex = source.rows.findIndex(row => row.id === match.rowId), row = source.rows[rowIndex]; if (!row || row.deleted) throw Error(text.worker); const order = rowIndex * limits.columns + match.column; if (order <= prior) throw Error(text.worker); prior = order; const value = row.values[match.column], writable = source.writable && source.options.kind === 'text' && value?.kind === 'text' && !source.columns[match.column].generated; if (writable !== match.replaceable) throw Error(text.worker);
    if (source.options.kind !== 'text') { if (match.ranges.length || (source.options.kind === 'null' ? value?.kind !== 'null' : value !== undefined || row.index !== undefined)) throw Error(text.worker); occurrences++; }
    else { if (!value || value.kind === 'null' || !match.ranges.length) throw Error(text.worker); let previousEnd = -1, previousStart = -1;
      for (const range of match.ranges) { if (!range || Object.keys(range).sort().join(',') !== 'end,start' || !Number.isInteger(range.start) || !Number.isInteger(range.end) || range.start < 0 || range.end < range.start || range.end > value.value.length || [range.start, range.end].some(at => at > 0 && at < value.value.length && value.value.charCodeAt(at) >= 0xdc00 && value.value.charCodeAt(at) <= 0xdfff && value.value.charCodeAt(at - 1) >= 0xd800 && value.value.charCodeAt(at - 1) <= 0xdbff) || range.start < previousEnd || range.start === previousStart || source.options.wholeCell && (range.start !== 0 || range.end !== value.value.length)) throw Error(text.worker); previousStart = range.start; previousEnd = range.end; occurrences++; }
    }
    if (occurrences > limits.matches) throw Error(text.worker);
  } return matches;
}
/** 回包补丁只能属于已确认匹配格与原before，全部TEXT/资格/单值/总量再次检查。 */
function checkedPatches(raw: unknown, proof: Proof, only?: SqliteFindOccurrence): SqliteTextPatch[] {
  const patches = copySqliteFindTransfer(raw) as SqliteTextPatch[]; if (!Array.isArray(patches) || !patches.length || patches.length > limits.patches) throw Error(text.worker); const seen = new Set<string>(), rows = new Set<string>(); let bytes = 0;
  for (const patch of patches) {
    if (!patch || Object.keys(patch).sort().join(',') !== 'after,before,column,rowId' || typeof patch.rowId !== 'string' || !Number.isInteger(patch.column) || typeof patch.before !== 'string' || typeof patch.after !== 'string' || patch.before === patch.after || patch.after.length > limits.valueUnits) throw Error(text.worker);
    const row = proof.owner.source.rows.find(row => row.id === patch.rowId), value = row?.values[patch.column], key = JSON.stringify([patch.rowId, patch.column]), match = proof.matches.find(match => match.rowId === patch.rowId && match.column === patch.column);
    if (!row || row.deleted || value?.kind !== 'text' || value.value !== patch.before || !match?.replaceable || seen.has(key) || only && (patch.rowId !== only.rowId || patch.column !== only.column)) throw Error(text.worker);
    seen.add(key); rows.add(row.id); bytes += new TextEncoder().encode(patch.after).length + proof.owner.source.columns[patch.column].name.length; if (bytes > limits.writeBytes || rows.size > limits.changedRows) throw Error(text.budget);
  } return patches;
}
/** 每次请求独占真实Worker，正常/异常/取消都等待准确terminate完成，不积累恶意回溯线程。 */
export class SqliteTableFindWorkerClient {
  private pending?: Pending; private serial = 0; private epoch = {}; private planRevision = 0; private disposed = false; private retiring: Promise<void> = Promise.resolve();
  private readonly timeoutMs: number; private readonly startupMs: number;
  constructor(private readonly createWorker: () => SqliteFindWorkerPort, timeoutMs: number = limits.timeoutMs, startupMs: number = limits.startupMs) { if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > limits.timeoutMs || !Number.isInteger(startupMs) || startupMs < 1 || startupMs > limits.startupMs) throw Error(text.invalid); this.timeoutMs = timeoutMs; this.startupMs = startupMs; }
  /** 新find永久撤销旧search/plan，原page/rows及选项在首个await前捕获。 */
  async find(page: SqliteTablePage, rows: readonly SqliteDraftRow[], options: SqliteFindOptions): Promise<SqliteFindResult> {
    this.epoch = {}; this.planRevision++; const epoch = this.epoch;
    try {
      const source = sqliteFindSource(page, rows, options), owner: Owner = { page, rows, rowOwners: rows.map(row => ({ row, values: row.values })), source, options, signature: sqliteFindSourceSignature(page, source), valid: true, current: () => !this.disposed && this.epoch === epoch };
      const result = await this.run({ operation: 'find', source }); if (result.status === 'blocked') return result; assertOwner(owner); if (result.operation !== 'find') throw Error(text.worker);
      const matches = checkedMatches(result.matches, source), occurrences = sqliteFindOccurrences(matches); for (const match of matches) { match.ranges.forEach(Object.freeze); Object.freeze(match.ranges); Object.freeze(match); } occurrences.forEach(value => { if (value.range) Object.freeze(value.range); Object.freeze(value); }); Object.freeze(matches); Object.freeze(occurrences);
      const output: SqliteFindReadyResult = Object.freeze({ status: 'ready', matches, occurrences }); searches.set(output, { client: this, owner, matches, occurrences }); return output;
    } catch (reason) { return blocked('invalid', reason instanceof Error && Object.values(text).includes(reason.message as any) ? reason.message : text.invalid); }
  }
  /** preview只接当前Client实际确认的find对象；单处还必须是该结果中的准确occurrence对象。 */
  async preview(found: SqliteFindReadyResult, replacement: string, only?: SqliteFindOccurrence): Promise<SqliteFindPreviewResult> {
    const revision = ++this.planRevision;
    try {
      const proof = searches.get(found); if (!proof || proof.client !== this || !proof.owner.source.writable || proof.owner.source.options.kind !== 'text' || only && (!proof.occurrences.includes(only) || !only.replaceable || !only.range)) throw Error(text.stale); assertOwner(proof.owner);
      copySqliteFindOptions(proof.owner.source.options, proof.owner.source.columns.length); if (typeof replacement !== 'string' || replacement.length > limits.replacement) throw Error(text.invalid); copySqliteFindTransfer(replacement);
      const result = await this.run({ operation: 'preview', source: proof.owner.source, replacement, ...(only ? { only } : {}) }); if (result.status === 'blocked') return result; assertOwner(proof.owner); if (revision !== this.planRevision || result.operation !== 'preview') throw Error(text.stale);
      const matches = checkedMatches(result.matches, proof.owner.source); if (JSON.stringify(matches) !== JSON.stringify(proof.matches)) throw Error(text.worker); const patches = checkedPatches(result.patches, proof, only), plan: SqliteTextReplacementPlan = Object.freeze({ changedCells: patches.length, changedRows: new Set(patches.map(patch => patch.rowId)).size });
      plans.set(plan, { owner: proof.owner, patches, used: false, current: () => !this.disposed && revision === this.planRevision }); return { status: 'ready', plan };
    } catch (reason) { return blocked('invalid', reason instanceof Error && Object.values(text).includes(reason.message as any) ? reason.message : text.invalid); }
  }
  /** 握手前不发送完整原文；运行和启动硬门分别计时，旧id/旧worker不能回应新请求。 */
  private async run(raw: SqliteFindWorkerRequest): Promise<SqliteFindWorkerResult> {
    const id = ++this.serial; await this.stop({ status: 'blocked', reason: 'cancelled', message: text.cancelled }); if (this.disposed || id !== this.serial) return blocked('cancelled', text.cancelled);
    let request: SqliteFindWorkerRequest; try { request = copySqliteFindTransfer(raw); } catch { return blocked('budget', text.budget); }
    return new Promise(resolve => {
      try {
        const worker = this.createWorker(), deadline = (running: boolean) => setTimeout(() => { if (this.pending?.id === id && this.pending.running === running) void this.stop(blocked('timeout', text.timeout)); }, running ? this.timeoutMs : this.startupMs);
        this.pending = { id, worker, request, running: false, timer: deadline(false), resolve };
        worker.onmessage = event => {
          const pending = this.pending; if (!pending || pending.id !== id || pending.worker !== worker) return;
          if (event.data?.type === 'dbark-sqlite-table-find-ready' && !pending.running) {
            if (event.data.version !== 1) { void this.stop(blocked('worker', text.worker)); return; } pending.running = true; clearTimeout(pending.timer); pending.timer = deadline(true); const payload = pending.request; pending.request = undefined;
            try { worker.postMessage({ id, request: payload }); } catch { void this.stop(blocked('worker', text.worker)); } return;
          }
          if (!pending.running || event.data?.id !== id) return;
          try { const result = copySqliteFindTransfer(event.data.result) as SqliteFindWorkerResult; if (!result || Object.keys(result).sort().join(',') !== (result.status === 'blocked' ? 'message,reason,status' : result.operation === 'preview' ? 'matches,operation,patches,status' : 'matches,operation,status') || result.status !== 'ready' && result.status !== 'blocked' || result.status === 'ready' && result.operation !== raw.operation || result.status === 'blocked' && !Object.values(text).includes(result.message as any)) throw Error(text.worker); void this.stop(result); } catch { void this.stop(blocked('worker', text.worker)); }
        };
        worker.onerror = event => { event.preventDefault(); if (this.pending?.worker === worker) void this.stop(blocked('worker', text.worker)); }; worker.onmessageerror = () => { if (this.pending?.worker === worker) void this.stop(blocked('worker', text.worker)); };
      } catch { if (this.pending?.id === id) void this.stop(blocked('worker', text.worker)); else resolve(blocked('worker', text.worker)); }
    });
  }
  /** 隔离旧回调后等待原线程退出；终止失败永久停用Client，不能宣称正常完成。 */
  private stop(result: SqliteFindWorkerResult): Promise<void> {
    const pending = this.pending; this.pending = undefined; if (!pending) return this.retiring; clearTimeout(pending.timer); pending.worker.onmessage = null; pending.worker.onerror = null; pending.worker.onmessageerror = null; const previous = this.retiring;
    this.retiring = (async () => { await previous; let completed = result; try { await pending.worker.terminate(); } catch { this.disposed = true; this.epoch = {}; completed = blocked('worker', text.worker); } finally { pending.request = undefined; pending.resolve(completed); } })(); return this.retiring;
  }
  /** 即使线程已ready，用户取消/选项修订也永久撤销旧search和全部替换计划。 */
  cancel(): Promise<void> { this.epoch = {}; this.planRevision++; this.serial++; return this.stop(blocked('cancelled', text.cancelled)); }
  /** 卸载后不能创建新线程，原terminate完成后才算释放。 */
  dispose(): Promise<void> { this.disposed = true; return this.cancel(); }
}
