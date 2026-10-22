import type { IndexPatch, TableIndexView } from '../shared/tableIndexPatches';
import type { TableIndexGetOutput, TableIndexPreviewOutput } from '../shared/tableIndexTasks';
import { indexPatchZh as text } from './locales/indexPatches.zh-CN';

/** 只识别明确的专属属性；不能把false当成无意图。 */
export function hasIndexOptimizerPatch(patches: readonly IndexPatch[]): boolean { return patches.some(patch => patch.op === 'alter' && Object.hasOwn(patch.changes, 'optimizerVisible')); }

/** 专属投影是唯一权限来源；旧解析器只读或缺完整重建模型不等于本属性不可恢复。 */
export function makeIndexOptimizerAlter(index: TableIndexView, visible: boolean): IndexPatch | null {
  const original = index.optimizer;
  if (!original || typeof original.visible !== 'boolean' || original.access.allowed !== true) throw Error(original?.access.reasons.join('\n') || text.optimizerReadonly);
  if (typeof visible !== 'boolean') throw Error(text.optimizerStale);
  return visible === original.visible ? null : { op: 'alter', indexRef: index.indexRef, changes: { optimizerVisible: visible } };
}

/** 读取时固定整个快照及投影对象图；观察到漂移后单向撤销，恢复旧值也不重新授权。 */
export class IndexOptimizerIntent {
  #invalid = false; readonly #check: (value: TableIndexGetOutput | null) => boolean;
  constructor(snapshot: TableIndexGetOutput, index: TableIndexView) {
    makeIndexOptimizerAlter(index, index.optimizer?.visible as boolean);
    const indexes = snapshot.indexes, columns = snapshot.columns, projection = index.optimizer!, access = projection.access;
    const entries = indexes.map(value => ({ value, projection: value.optimizer, access: value.optimizer?.access })), key = JSON.stringify(snapshot);
    this.#check = value => value === snapshot && value.indexes === indexes && value.columns === columns && indexes.length === entries.length
      && indexes.every((item, position) => item === entries[position].value && item.optimizer === entries[position].projection && item.optimizer?.access === entries[position].access)
      && indexes.includes(index) && indexes.filter(item => item.indexRef === index.indexRef).length === 1 && index.optimizer === projection && projection.access === access && access.allowed === true
      && Number.isFinite(Date.parse(value.expiresAt)) && Date.now() < Date.parse(value.expiresAt) && JSON.stringify(value) === key;
  }
  /** 缺字段、过期或同对象内容变化一律失效，只有显式重读可获得新意图。 */
  current(value: TableIndexGetOutput | null): boolean { if (this.#invalid) return false; try { if (this.#check(value)) return true; } catch { /* 不完整或不可比较来源拒绝。 */ } this.invalidate(); return false; }
  /** 目标版本变化及释放快照立即撤销，不能等待下一次输入才观察。 */
  invalidate(): void { this.#invalid = true; }
}

/** 预览绑定原补丁、原目录和全部回执内容；客户端从不重建服务器SQL。 */
export class IndexOptimizerPreview {
  #invalid = false; #consumed = false; readonly #payload: string; readonly #receipt: string;
  constructor(readonly intent: IndexOptimizerIntent, readonly patches: IndexPatch[], readonly preview: TableIndexPreviewOutput) {
    this.#payload = JSON.stringify(patches); this.#receipt = JSON.stringify(preview);
    if (!['ddl-implicit-commit', 'external-ddl-window', 'index-optimizer-change'].every(id => preview.requiredAcknowledgements.includes(id))) this.#invalid = true;
  }
  /** applying仅用于本次消费后的内部复核，不能让第二次事件重新取得执行权。 */
  current(snapshot: TableIndexGetOutput | null, patches: IndexPatch[], preview: TableIndexPreviewOutput | null, applying = false): boolean {
    if (this.#invalid || this.#consumed && !applying) return false;
    try { if (preview === this.preview && patches === this.patches && this.intent.current(snapshot) && JSON.stringify(patches) === this.#payload && JSON.stringify(preview) === this.#receipt && Number.isFinite(Date.parse(preview.expiresAt)) && Date.now() < Date.parse(preview.expiresAt)) return true; } catch { /* 迟到或损坏的回执不能继续执行。 */ }
    this.#invalid = true; return false;
  }
  /** 在调用父守卫前消费，父同步重入不会产生第二次DDL。 */
  consume(): void { this.#consumed = true; }
}
