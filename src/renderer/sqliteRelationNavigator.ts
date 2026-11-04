import type { SqliteTablePage } from '../shared/sqliteTableBrowse';
import type { SqliteOriginalValue } from '../shared/sqliteTableEdit';
import type { SqliteReferenceOutput } from '../shared/sqliteReference';
import type { SqliteIncomingOutput } from '../shared/sqliteIncoming';
import { SqliteReferenceReader, type SqliteReferenceServices } from './sqliteReferenceReader';
import { SqliteIncomingReader, type SqliteIncomingServices } from './sqliteIncomingReader';
import { captureSqliteReferenceSource } from './sqliteReferenceSource';

export type SqliteRelationDirection = 'parents' | 'children';
type Output = SqliteReferenceOutput | SqliteIncomingOutput;
interface Panel { catalog?: Output; selected?: number; data?: Output; row?: number; }
interface Node { id: number; source: SqliteTablePage; values: readonly (SqliteOriginalValue | undefined)[]; current(): boolean; label: string; direction: SqliteRelationDirection; panels: Record<SqliteRelationDirection, Panel>; reader?: SqliteReferenceReader | SqliteIncomingReader; }
export interface SqliteRelationView { revision: object; node: number; source: SqliteTablePage; direction: SqliteRelationDirection; panel: Readonly<Panel>; path: string[]; position: number; history: number; busy: boolean; closing: boolean; valid: boolean; error: string; }
export interface SqliteRelationServices { parents: SqliteReferenceServices; children: SqliteIncomingServices; activity(delta: 1 | -1): void; }
interface Operation { node: Node; reader: SqliteReferenceReader | SqliteIncomingReader; stopped: boolean; done: Promise<void>; }
/** 历史只保留当前会话，不持久化记录值；序列化预算保守计算共享页，拒绝静默丢失返回位置。 */
export const sqliteRelationLimits = { nodes: 20, bytes: 32 * 1024 * 1024 } as const;

/** 单窗口双向关联与本地历史；所有层级始终受最初源行／标签的永久撤权保护。 */
export class SqliteRelationNavigator {
  private nodes: Node[];
  private position = 0;
  private sequence = 1;
  private revision: object = {};
  private dead = false;
  private disposed = false;
  private closing = false;
  private error = '';
  private operation?: Operation;
  private listeners = new Set<() => void>();
  constructor(source: SqliteTablePage, values: readonly (SqliteOriginalValue | undefined)[], private readonly guard: () => boolean, private readonly ports: SqliteRelationServices) {
    this.nodes = [{ id: 1, source, values, current: () => true, label: source.target.table, direction: 'parents', panels: { parents: {}, children: {} } }];
  }
  /** 变化只通知视图；同步重入也能看到已登记的操作与历史位置。 */
  private emit(): void { this.revision = {}; if (!this.disposed) for (const listener of this.listeners) listener(); }
  /** 视图订阅不接管数据库资源，卸载只移除准确监听器。 */
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  /** 原来源或当前节点一旦漂移就留下墓碑；返回历史不能复活失效读取权。 */
  current(): boolean {
    if (!this.dead && !this.disposed) try { if (!this.guard() || this.nodes.some(node => !node.current())) this.dead = true; } catch { this.dead = true; }
    if (this.dead) this.operation?.reader.invalidate(); return !this.dead && !this.disposed;
  }
  /** 工作区同步通知只撤权，不触发目录或业务行读取。 */
  observe(): void { const before = this.dead; this.current(); if (before !== this.dead) this.emit(); }
  /** 每次视图携带不可恢复的版本票据，历史数据与活动操作分别公开。 */
  get view(): SqliteRelationView {
    const node = this.nodes[this.position]; return { revision: this.revision, node: node.id, source: node.source, direction: node.direction, panel: node.panels[node.direction], path: this.nodes.map(item => item.label), position: this.position, history: this.nodes.length, busy: !!this.operation, closing: this.closing, valid: this.current(), error: this.error };
  }
  /** 旧渲染／旧网格／重入事件均不得接续到新节点；导航和读取都须空闲。 */
  ready(view: SqliteRelationView): boolean { return this.current() && !this.operation && !this.closing && view.revision === this.revision && view.node === this.nodes[this.position].id && view.direction === this.nodes[this.position].direction; }
  /** 保守预算含源页、目录和两个方向的最后一页，不保存更多隐式缓存。 */
  private within(nodes: Node[]): boolean { return nodes.length <= sqliteRelationLimits.nodes && new TextEncoder().encode(JSON.stringify(nodes.map(node => [node.source, node.panels]))).length <= sqliteRelationLimits.bytes; }
  /** 离开节点后销毁旧reader，保留只读数据；回来时创建新reader而不复活旧异步能力。 */
  private retire(node: Node): void { node.reader?.invalidate(); node.reader = undefined; }
  /** 两个方向分别保留最后目录和结果；方向切换只改变本地面板。 */
  direction(view: SqliteRelationView, direction: SqliteRelationDirection): boolean {
    if (!this.ready(view) || !['parents', 'children'].includes(direction)) return false; const node = this.nodes[this.position];
    if (node.direction === direction) return true; this.retire(node); node.direction = direction; this.error = ''; this.emit(); return true;
  }
  /** 声明只能来自当前已校验目录，选择后撤销旧结果和旧行。 */
  select(view: SqliteRelationView, selected: number): boolean {
    if (!this.ready(view)) return false; const node = this.nodes[this.position], panel = node.panels[node.direction], catalog = panel.catalog;
    if (!catalog || !Number.isSafeInteger(selected)) return false;
    const okay = 'references' in catalog ? !!catalog.references[selected]?.referencedColumns : catalog.source.foreignKeys.some(key => key.ordinal === selected);
    if (!okay) return false; panel.selected = selected; panel.data = undefined; panel.row = undefined; this.error = ''; this.emit(); return true;
  }
  /** 精确页身份和原行身份共同约束选择，不从格式化显示拼装下一层父键。 */
  row(view: SqliteRelationView, page: SqliteTablePage, row: SqliteTablePage['result']['rows'][number] | null): boolean {
    if (!this.ready(view)) return false; const panel = this.nodes[this.position].panels[view.direction]; if (panel.data?.page !== page) return false;
    const index = row ? page.result.rows.indexOf(row) : -1; panel.row = index < 0 ? undefined : index; this.emit(); return true;
  }
  /** 继续浏览只捕获本页已保存原值，切换和导航均不发起数据库任务。 */
  navigate(view: SqliteRelationView, direction: SqliteRelationDirection): boolean {
    if (!this.ready(view) || !['parents', 'children'].includes(direction)) return false; const panel = this.nodes[this.position].panels[view.direction], page = panel.data?.page, index = panel.row;
    if (!page || index === undefined) return false;
    try {
      const captured = captureSqliteReferenceSource(page, index), node: Node = { id: this.sequence + 1, source: page, values: captured.values, current: captured.current, label: page.target.table + ' · ' + (page.offset + index + 1), direction, panels: { parents: {}, children: {} } };
      const next = [...this.nodes.slice(0, this.position + 1), node]; if (!this.within(next)) throw Error('关联历史超过20个位置或32MiB，请返回较早位置后改走其它分支');
      this.retire(this.nodes[this.position]); this.nodes = next; this.position++; this.sequence++; this.error = ''; this.emit(); return true;
    } catch (failure) { this.error = failure instanceof Error ? failure.message : String(failure); this.emit(); return false; }
  }
  /** 返回／前进仅恢复本地已读结果，不自动重查；旧按钮不能借返回到同一位置复活。 */
  travel(view: SqliteRelationView, delta: -1 | 1): boolean {
    if (!this.ready(view) || ![-1, 1].includes(delta)) return false; const next = this.position + delta; if (next < 0 || next >= this.nodes.length) return false;
    this.retire(this.nodes[this.position]); this.position = next; this.error = ''; this.current(); this.emit(); return true;
  }
  /** 每个活动节点只接管一个reader，源guard绑定准确节点而不是可恢复的数组位置。 */
  private reader(node: Node): SqliteReferenceReader | SqliteIncomingReader {
    if (!node.reader) { const guard = () => this.current() && this.nodes[this.position] === node;
      node.reader = node.direction === 'parents' ? new SqliteReferenceReader(node.source, node.values, guard, this.ports.parents) : new SqliteIncomingReader(node.source, node.values, guard, this.ports.children);
    } return node.reader;
  }
  /** 同步占位后获取根来源租约；原读与取消ACK都终态后释放，关闭和重入不能提前导航。 */
  private run(view: SqliteRelationView, action: (reader: SqliteReferenceReader | SqliteIncomingReader) => Promise<Output>, publish: (output: Output, panel: Panel) => void): Promise<void> {
    if (!this.ready(view)) return Promise.resolve(); const node = this.nodes[this.position], panel = node.panels[node.direction], reader = this.reader(node);
    const op: Operation = { node, reader, stopped: false, done: Promise.resolve() }; this.operation = op; panel.data = undefined; panel.row = undefined; this.error = '';
    const pending = (async () => { await Promise.resolve(); let acquired = false;
      try { if (op.stopped || !this.current()) throw Error('关联读取已停止或来源变化'); this.ports.activity(1); acquired = true; if (op.stopped || !this.current()) throw Error('关联读取已停止或来源变化');
        const output = await action(reader); if (op.stopped || !this.current() || this.operation !== op || this.nodes[this.position] !== node) throw Error('关联读取已停止或来源变化');
        const next: Panel = { ...panel }; publish(output, next); const before = node.panels[node.direction]; node.panels[node.direction] = next;
        if (!this.within(this.nodes)) { node.panels[node.direction] = before; throw Error('关联历史超过32MiB，未保留本次结果，请缩小范围或从较早位置重新开始'); }
      } catch (failure) { this.error = failure instanceof Error ? failure.message : String(failure); }
      finally { try { if (acquired) this.ports.activity(-1); } finally { if (this.operation === op) this.operation = undefined; this.emit(); } }
    })(); op.done = pending; this.emit(); return pending;
  }
  /** 明确刷新目录先撤下旧声明，父结构缓存也随原reader目录读取重置。 */
  catalog(view: SqliteRelationView): Promise<void> {
    if (!this.ready(view)) return Promise.resolve(); const node = this.nodes[this.position], panel = node.panels[node.direction]; panel.catalog = undefined; panel.selected = undefined;
    return this.run(view, reader => reader.catalog(), (output, next) => { next.catalog = output; next.selected = 'references' in output ? (() => { const index = output.references.findIndex(entry => !!entry.referencedColumns); return index < 0 ? undefined : index; })() : output.source.foreignKeys[0]?.ordinal; });
  }
  /** 返回后父页仍绑定旧父hash；明确刷新目录才放弃该父结构锚点。 */
  page(view: SqliteRelationView, offset: number): Promise<void> {
    if (!this.ready(view)) return Promise.resolve(); const panel = this.nodes[this.position].panels[view.direction], catalog = panel.catalog, selected = panel.selected, parentHash = panel.data?.page?.schemaKey;
    if (!catalog || selected === undefined) return Promise.resolve();
    if ('references' in catalog) { const entry = catalog.references[selected]; if (!entry?.referencedColumns) return Promise.resolve(); return this.run(view, reader => (reader as SqliteIncomingReader).page(entry, offset), (output, next) => { next.data = output; }); }
    const key = catalog.source.foreignKeys.find(key => key.ordinal === selected); if (!key) return Promise.resolve();
    return this.run(view, reader => (reader as SqliteReferenceReader).page(key, offset, 50, parentHash), (output, next) => { next.data = output; });
  }
  /** 只取消准确原任务；原完成与ACK都终态前保持busy，未发送则不产生后台cancel。 */
  async stop(): Promise<void> { const op = this.operation; if (!op) return; op.stopped = true; const stopped = op.reader.stop(); const values = await Promise.allSettled([op.done, stopped]); if (values[1].status === 'rejected') { this.error = values[1].reason instanceof Error ? values[1].reason.message : String(values[1].reason); this.emit(); throw values[1].reason; } }
  /** 关闭期间先同步撤销全部动作，再等待原读取终态。 */
  async close(): Promise<void> { if (this.closing) throw Error('原关联窗口正在关闭'); this.closing = true; this.emit(); try { await this.stop(); } catch (failure) { this.closing = false; this.error = failure instanceof Error ? failure.message : String(failure); this.emit(); throw failure; } }
  /** 卸载永久撤权并停止准确原读，异步收尾仍负责归还根租约。 */
  dispose(): void { this.disposed = true; this.dead = true; for (const node of this.nodes) node.reader?.invalidate(); void this.stop().catch(() => undefined); this.listeners.clear(); }
}
