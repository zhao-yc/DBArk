import { csvExportTargetKey, validateCsvExportColumnNames, type CsvExportFieldsOutput, type CsvExportSelection, type CsvExportTarget } from '../shared/csvExportFields';
export interface CsvExportContext extends CsvExportTarget { version: number; }
export type CsvExportFieldState = { key: string; status: 'loading' | 'consumed' } | { key: string; status: 'failed'; error: string } | { key: string; status: 'ready'; catalog: CsvExportFieldsOutput; selected: string[] } | null;
interface Dependencies { read(target: CsvExportTarget, taskId: string): Promise<CsvExportFieldsOutput>; release(catalogId: string): Promise<void>; taskId(): string; cleanupError(reason: unknown): void; }
/** 连接修订和精确目标共同绑定目录，不用可碰撞分隔符或当前活动表猜来源。 */
export function csvExportContextKey(context: CsvExportContext): string { return JSON.stringify([csvExportTargetKey(context), context.version]); }
/** CSV表导出专用小型协调器；目录迟到、失效和消费均不触发实际导出。 */
export class CsvExportFieldsController {
  private generation = 0;
  private state: CsvExportFieldState = null;
  private readonly owned = new Set<string>();
  private readonly releases = new Map<string, Promise<void>>();
  constructor(private readonly dependencies: Dependencies, private readonly publish: (state: CsvExportFieldState) => void, private readonly now = () => Date.now()) {}
  /** 无效TTL和未知目标永远不能提供可执行选择。 */
  ready(context: CsvExportContext | null): Extract<CsvExportFieldState, { status: 'ready' }> | null {
    const state = this.state;
    return context && state?.status === 'ready' && state.key === csvExportContextKey(context) && Number.isFinite(Date.parse(state.catalog.expiresAt)) && Date.parse(state.catalog.expiresAt) > this.now() ? state : null;
  }
  /** 释放责任保留到成功响应；并发清理共用同一Promise，不会遗漏失败项。 */
  private async release(id: string): Promise<void> {
    let pending = this.releases.get(id);
    if (!pending) { pending = this.dependencies.release(id).then(() => { this.owned.delete(id); }); this.releases.set(id, pending); }
    try { await pending; } finally { if (this.releases.get(id) === pending) this.releases.delete(id); }
  }
  /** 失败逐项反馈，不因首个失败跳过其他令牌。 */
  private async releaseAll(): Promise<void> { for (const id of [...this.owned]) try { await this.release(id); } catch (reason) { this.dependencies.cleanupError(reason); } }
  /** 重读会重置字段选择；旧或已离开目标的响应只释放自己，不覆盖新目录。 */
  async prepare(context: CsvExportContext | null): Promise<void> {
    const generation = ++this.generation, key = context ? csvExportContextKey(context) : '';
    this.update(context ? { key, status: 'loading' } : null); await this.releaseAll();
    if (!context || generation !== this.generation) return;
    try {
      const catalog = await this.dependencies.read({ connectionId: context.connectionId, database: context.database, table: context.table }, this.dependencies.taskId()); this.owned.add(catalog.catalogId);
      if (generation !== this.generation) { await this.release(catalog.catalogId); return; }
      if (csvExportTargetKey(catalog.target) !== csvExportTargetKey(context) || !Number.isFinite(Date.parse(catalog.expiresAt)) || Date.parse(catalog.expiresAt) <= this.now()) { await this.release(catalog.catalogId); throw Error('CSV字段目录目标不符或已过期，请重新读取'); }
      const selected = validateCsvExportColumnNames(catalog.columns.map(column => column.name));
      this.update({ key, status: 'ready', catalog, selected });
    } catch (reason) { if (generation === this.generation) this.update({ key, status: 'failed', error: reason instanceof Error ? reason.message : String(reason) }); else this.dependencies.cleanupError(reason); }
  }
  /** 仅从实际目录勾选，重新加入的字段放在末尾，原目录顺序不被篡改。 */
  select(context: CsvExportContext, name: string, checked: boolean): void {
    const state = this.ready(context); if (!state || !state.catalog.columns.some(column => column.name === name)) { this.update({ key: csvExportContextKey(context), status: 'failed', error: 'CSV字段目录已失效，请重新读取' }); return; }
    if (checked && state.selected.includes(name)) return;
    const selected = state.selected.filter(value => value !== name); if (checked) selected.push(name); this.update({ ...state, selected });
  }
  /** 顺序只移动当前选择，不从显示位置猜数据库字段。 */
  move(context: CsvExportContext, name: string, offset: -1 | 1): void {
    const state = this.ready(context); if (!state) { this.update({ key: csvExportContextKey(context), status: 'failed', error: 'CSV字段目录已失效，请重新读取' }); return; }
    const selected = state.selected.slice(), from = selected.indexOf(name), to = from + offset;
    if (from < 0 || to < 0 || to >= selected.length) return; [selected[from], selected[to]] = [selected[to], selected[from]]; this.update({ ...state, selected });
  }
  /** 一次点击先消费本地能力；失败只能显式重读，不自动重用旧目录或重发导出。 */
  take(context: CsvExportContext | null): CsvExportSelection {
    const state = this.ready(context); if (!state) throw Error('请先重新读取CSV字段目录');
    const columns = validateCsvExportColumnNames(state.selected); this.update({ key: state.key, status: 'consumed' }); return { catalogId: state.catalog.catalogId, columns };
  }
  /** 离开窗口或切换目标立即失效；迟到目录仍由其原请求负责精确释放。 */
  cancel(): void { this.generation++; this.state = null; void this.releaseAll(); }
  /** 只发布当前代次的原子状态，不在渲染阶段执行网络操作。 */
  private update(state: CsvExportFieldState) { this.state = state; this.publish(state); }
}
