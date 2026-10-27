import { fileImportKeyCatalogSchema, type FileImportKeyCatalog, type FileImportConflictSelection } from '../shared/fileImportConflict';
import type { DataRow } from '../shared/contracts';
import { fileImportConflictZh as text } from './locales/fileImportConflict.zh-CN';

export type ImportConflictMode = 'insert' | FileImportConflictSelection['mode'];
export interface ImportConflictSource {
  identity: string; connectionId: string; database: string; table: string; connectionVersion: number; revision: number;
  mapping: Record<string, string>; rows: DataRow[];
}
export interface ImportConflictState {
  revision: number; mode: ImportConflictMode; status: 'idle' | 'loading' | 'ready' | 'failed';
  source?: string; catalog?: FileImportKeyCatalog; key: string; error?: string;
}
export const initialImportConflictState = (): ImportConflictState => ({ revision: 0, mode: 'insert', status: 'idle', key: '' });

/** 只核映射完整性和样本缺值，不在浏览器比较键值或宣称全文件没有冲突。 */
export function importConflictKeyReason(source: ImportConflictSource, key: FileImportKeyCatalog['keys'][number], mode: ImportConflictMode): string | undefined {
  if (!key.reliable) return key.reason ?? text.noKey;
  const sources = key.columns.map(column => Object.keys(source.mapping).filter(name => source.mapping[name] === column));
  if (sources.some(names => names.length !== 1)) return text.unmapped;
  if (source.rows.some(row => sources.some(([name]) => !Object.hasOwn(row, name) || row[name] === undefined || row[name] === null))) return text.nullKey;
  if ((mode === 'upsert' || mode === 'update-existing') && !Object.values(source.mapping).some(name => !!name && !key.columns.includes(name))) return text.noUpdate;
}

interface Services {
  current(source: ImportConflictSource): boolean;
  open(source: ImportConflictSource): Promise<unknown>;
  read(source: ImportConflictSource, taskId: string): Promise<unknown>;
  cancel(taskId: string): Promise<unknown>;
  cancelFailure?(): void;
  uid(): string; timeoutMs?: number;
}
interface PendingCatalog { taskId: string; readSent: boolean; cancelSent: boolean; cancel(): void; }

/** 一次显式选择对应一次只读目录；来源ABA、超时和旧回包均不能恢复旧策略。 */
export class ImportConflictController {
  private generation = 0;
  private pending?: PendingCatalog;
  /** 注入原来源校验与目录任务端口，首帧状态与组件共用同一对象身份。 */
  constructor(private readonly services: Services, private readonly publish: (state: ImportConflictState) => void, private state = initialImportConflictState()) {}
  /** 返回当前快照供控件持有，执行时还须核对同一对象，不能按相同字段复活旧事件。 */
  snapshot(): ImportConflictState { return this.state; }
  /** 同步核对快照身份和原文件来源，阻止渲染前的旧回调跨来源操作。 */
  current(source: ImportConflictSource | null, expected: ImportConflictState): boolean { return !!source && this.state === expected && this.services.current(source); }

  /** 新来源回到只新增，不让配置套用或同值ABA隐式携带更新权限。 */
  reset(): void {
    this.generation++; this.pending?.cancel(); this.pending = undefined;
    this.update({ revision: this.state.revision + 1, mode: 'insert', status: 'idle', key: '' });
  }

  /** 用户明确切换策略后重新读取目录，超时或来源撤销时取消本次已投递任务。 */
  async chooseMode(source: ImportConflictSource, mode: ImportConflictMode, expected: ImportConflictState): Promise<void> {
    if (!this.current(source, expected)) return;
    this.generation++; this.pending?.cancel(); this.pending = undefined;
    if (mode === 'insert') { this.update({ revision: this.state.revision + 1, mode, status: 'idle', key: '' }); return; }
    if (!['skip-existing', 'upsert', 'update-existing'].includes(mode)) return;
    const generation = this.generation;
    this.update({ revision: this.state.revision + 1, mode, status: 'loading', key: '', source: source.identity });
    const active = () => this.generation === generation && this.services.current(source);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let interrupt!: (reason: string) => void;
    const interrupted = new Promise<never>((_resolve, reject) => { interrupt = reason => reject(Error(reason)); });
    const pending: PendingCatalog = { taskId: this.services.uid(), readSent: false, cancelSent: false, cancel: () => { interrupt(text.stale); this.cancelRead(pending); } };
    this.pending = pending;
    timer = setTimeout(() => { interrupt(text.timeout); this.cancelRead(pending); }, this.services.timeoutMs ?? 15000);
    try {
      const reading = (async () => {
        await this.services.open(source); if (!active()) throw Error(text.stale);
        pending.readSent = true;
        const value = fileImportKeyCatalogSchema.parse(await this.services.read(source, pending.taskId));
        if (!active()) throw Error(text.stale);
        if (value.connectionId !== source.connectionId || value.database !== source.database || value.table !== source.table || new Set(value.keys.map(key => key.name)).size !== value.keys.length) throw Error(text.catalogInvalid);
        return value;
      })();
      const catalog = await Promise.race([reading, interrupted]);
      if (active()) this.update({ revision: this.state.revision + 1, mode, status: 'ready', key: '', source: source.identity, catalog });
    } catch (error) {
      if (active()) { this.generation++; this.update({ revision: this.state.revision + 1, mode, status: 'failed', key: '', source: source.identity, error: error instanceof Error ? error.message : String(error) }); }
    } finally { if (timer) clearTimeout(timer); if (this.pending === pending) this.pending = undefined; }
  }

  /** 匹配键只能从本目录明确选取，不能借旧事件或非可靠索引领取更新能力。 */
  chooseKey(source: ImportConflictSource, name: string, expected: ImportConflictState): void {
    if (!this.current(source, expected) || expected.status !== 'ready' || expected.source !== source.identity) return;
    const key = expected.catalog?.keys.find(key => key.name === name);
    if (name && (!key || importConflictKeyReason(source, key, expected.mode))) return;
    this.update({ ...expected, revision: expected.revision + 1, key: name });
  }

  /** 执行前同步冻结精确选择；默认模式省略字段，非默认不允许悄悄回退新增。 */
  selection(source: ImportConflictSource | null, expected: ImportConflictState): FileImportConflictSelection | undefined {
    if (!this.current(source, expected)) throw Error(text.stale);
    if (expected.mode === 'insert') return;
    const key = expected.catalog?.keys.find(key => key.name === expected.key);
    if (expected.status !== 'ready' || expected.source !== source!.identity || !key) throw Error(text.noKey);
    const reason = importConflictKeyReason(source!, key, expected.mode); if (reason) throw Error(reason);
    return { mode: expected.mode, schemaHash: expected.catalog!.schemaHash, key: { name: key.name, columns: [...key.columns] } };
  }
  /** 控件可用性复用真实执行选择校验，不以目录已加载代替完整匹配键验证。 */
  canExecute(source: ImportConflictSource | null, expected: ImportConflictState): boolean { try { this.selection(source, expected); return true; } catch { return false; } }
  /** 卸载撤销本地等待并取消已投递目录任务，不在迟到回包中重新请求或发布状态。 */
  dispose(): void { this.generation++; this.pending?.cancel(); this.pending = undefined; }
  /** 只取消本次已投递目录任务一次；取消失败另报资源未知，不替换原超时或新来源状态。 */
  private cancelRead(pending: PendingCatalog): void {
    if (!pending.readSent || pending.cancelSent) return;
    pending.cancelSent = true;
    try { void this.services.cancel(pending.taskId).catch(() => this.services.cancelFailure?.()); }
    catch { this.services.cancelFailure?.(); }
  }
  /** 先原子替换内部身份再发布界面快照，同事件栈内的旧执行闭包随即失效。 */
  private update(state: ImportConflictState): void { this.state = state; this.publish(state); }
}
