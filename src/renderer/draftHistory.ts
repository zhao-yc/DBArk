import type { DataRow, CellValue } from '../shared/contracts';
import type { DraftRow } from './dataChanges';
import { draftHistoryZh as text } from './locales/draftHistory.zh-CN';

export const draftHistoryLimits = { operations: 100, bytes: 8 * 1024 * 1024 } as const;
interface RowVersion { index: number; row: DraftRow; }
interface Patch { before?: RowVersion; after?: RowVersion; }
interface Operation { patches: Map<string, Patch>; bytes: number; }

/** 不序列化或展开BLOB，按UTF-16文本及保守对象开销计算保留预算，提前停止超限扫描。 */
function rowBytes(row: DraftRow, maximum: number): number {
  let bytes = 160 + row.id.length * 2;
  for (const data of [row.data, row.original]) if (data) {
    bytes += 64;
    for (const key in data) if (Object.hasOwn(data, key)) {
      const value = data[key];
      bytes += 64 + key.length * 2 + (typeof value === 'string' ? value.length * 2 : value && typeof value === 'object' ? 64 + value.base64.length * 2 : 16);
      if (bytes > maximum) return bytes;
    }
  }
  return bytes;
}
/** 值比较不解析JSON或数值；缺字段与显式undefined仍是不同结构。 */
function sameValue(a: CellValue, b: CellValue): boolean { return Object.is(a, b) || !!a && !!b && typeof a === 'object' && typeof b === 'object' && a.type === b.type && a.base64 === b.base64; }
function sameData(a: DataRow, b: DataRow): boolean {
  if (a === b) return true;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && sameValue(a[key], b[key]));
}
function sameRow(a: DraftRow, b: DraftRow): boolean { return a === b || a.original === b.original && a.inserted === b.inserted && a.deleted === b.deleted && sameData(a.data, b.data); }

/** 只保留变化行的不可变版本，不保留每一步整页数组，也不克隆完整页/原值/字节。 */
export class DraftHistory {
  private undoStack: Operation[] = [];
  private redoStack: Operation[] = [];
  private anchor: DraftRow[] | null = null;
  private bytes = 0;
  notice = '';
  constructor(private readonly limits: { operations: number; bytes: number } = draftHistoryLimits) {
    if (!Number.isSafeInteger(limits.operations) || limits.operations < 1 || !Number.isSafeInteger(limits.bytes) || limits.bytes < 1) throw Error(text.changed);
  }
  get status() { return { undo: this.undoStack.length, redo: this.redoStack.length, bytes: this.bytes }; }
  /** 让复制键保护标记只随当前草稿和有界历史保留，撤销后分支编辑不泄漏旧UUID集合。 */
  retainedIds(): Set<string> {
    const ids = new Set<string>();
    for (const stack of [this.undoStack, this.redoStack]) for (const entry of stack) for (const id of entry.patches.keys()) ids.add(id);
    return ids;
  }
  /** 清除只释放历史，不回写当前草稿；加载/代次/提交边界同步调用。 */
  clear() { this.undoStack = []; this.redoStack = []; this.bytes = 0; this.anchor = null; this.notice = ''; }
  /** 一次已通过原入口守卫的本地发布就是一项操作；超限不拒绝或截断用户草稿。 */
  record(before: DraftRow[], after: DraftRow[]) {
    if (this.anchor && this.anchor !== before) this.clear();
    this.anchor = after;
    if (before === after) return;
    const prior = new Map(before.map((row, index) => [row.id, { row, index }]));
    const next = new Map(after.map((row, index) => [row.id, { row, index }]));
    if (prior.size !== before.length || next.size !== after.length) { this.clear(); this.anchor = after; this.notice = text.changed; return; }
    const patches = new Map<string, Patch>(); let bytes = 128;
    for (const [id, old] of prior) {
      const value = next.get(id);
      if (value && old.index === value.index && sameRow(old.row, value.row)) continue;
      bytes += 96 + id.length * 2 + rowBytes(old.row, this.limits.bytes) + (value ? rowBytes(value.row, this.limits.bytes) : 0);
      if (bytes > this.limits.bytes) { this.clear(); this.anchor = after; this.notice = text.overflow; return; }
      patches.set(id, { before: old, after: value });
    }
    for (const [id, value] of next) if (!prior.has(id)) {
      bytes += 96 + id.length * 2 + rowBytes(value.row, this.limits.bytes);
      if (bytes > this.limits.bytes) { this.clear(); this.anchor = after; this.notice = text.overflow; return; }
      patches.set(id, { after: value });
    }
    if (!patches.size) return;
    this.notice = ''; this.bytes -= this.redoStack.reduce((total, entry) => total + entry.bytes, 0); this.redoStack = [];
    this.undoStack.push({ patches, bytes }); this.bytes += bytes;
    while (this.undoStack.length > this.limits.operations || this.bytes > this.limits.bytes) this.bytes -= this.undoStack.shift()!.bytes;
  }
  /** 重放只应用保存的行差异；UUID/original不变，当前data身份重新分配，旧输入票据不能ABA复活。 */
  move(rows: DraftRow[], direction: 'undo' | 'redo'): DraftRow[] | null {
    if (!this.undoStack.length && !this.redoStack.length) return null;
    if (this.anchor !== rows) { this.clear(); this.notice = text.changed; return null; }
    const from = direction === 'undo' ? this.undoStack : this.redoStack, to = direction === 'undo' ? this.redoStack : this.undoStack;
    const operation = from.at(-1); if (!operation) return null;
    const remaining = rows.filter(row => !operation.patches.has(row.id));
    const target = direction === 'undo' ? 'before' : 'after';
    let count = remaining.length;
    for (const patch of operation.patches.values()) if (patch[target]) count++;
    const result = new Array<DraftRow>(count);
    for (const patch of operation.patches.values()) {
      const saved = patch[target]; if (saved) result[saved.index] = { ...saved.row, data: { ...saved.row.data } };
    }
    let index = 0;
    for (let slot = 0; slot < result.length; slot++) if (!result[slot]) result[slot] = remaining[index++];
    from.pop(); to.push(operation); this.anchor = result; this.notice = ''; return result;
  }
}

/** 仅网格活动焦点可处理组合键；输入框、Monaco和IME保留各自原生撤销。 */
export function draftHistoryKey(event: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }, activeGrid: boolean): 'undo' | 'redo' | null {
  if (!activeGrid || event.altKey || (!event.ctrlKey && !event.metaKey)) return null;
  const key = event.key.toLowerCase();
  return key === 'z' ? event.shiftKey ? 'redo' : 'undo' : key === 'y' && !event.shiftKey ? 'redo' : null;
}
