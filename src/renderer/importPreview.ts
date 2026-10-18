import type { DataRow, TableInfo } from '../shared/contracts';
import { csvImportDelimiter, type CsvImportDelimiter } from '../shared/csvImport';

export interface ImportPreviewTarget { connectionId: string; database: string; table: string; }
export interface ImportPreviewContext extends ImportPreviewTarget {
  fileToken: string; format: 'csv' | 'json'; encoding: 'utf8' | 'utf16le' | 'gb18030';
  csvDelimiter?: CsvImportDelimiter;
}
export interface ImportSample { columns: string[]; rows: DataRow[]; }
export interface ReadyImportPreview { key: string; status: 'ready'; info: TableInfo; sample: ImportSample; mapping: Record<string, string>; }
export type ImportPreviewState = ReadyImportPreview | { key: string; status: 'loading' } | { key: string; status: 'failed'; error: string } | null;
interface PreviewDependencies {
  metadata: (target: ImportPreviewTarget) => Promise<TableInfo>;
  preview: (context: ImportPreviewContext) => Promise<ImportSample>;
}

/** 元数据只按目标缓存，文件、格式、编码和分隔符另行组成预览标识。 */
function targetKey(target: ImportPreviewTarget): string { return JSON.stringify([target.connectionId, target.database, target.table]); }

/** 使用结构化键避免名称分隔符碰撞；就绪判断在渲染阶段完成，不等待副作用失效旧状态。 */
export function importPreviewKey(context: ImportPreviewContext): string {
  return JSON.stringify([context.connectionId, context.database, context.table, context.fileToken, context.format, context.encoding, csvImportDelimiter(context.format, context.csvDelimiter)]);
}

/** 只有完整匹配当前上下文的预览可见且可导入，旧预览和失败状态均不能借用旧映射。 */
export function readyImportPreview(state: ImportPreviewState, context: ImportPreviewContext | null): ReadyImportPreview | null {
  return context && state?.status === 'ready' && state.key === importPreviewKey(context) ? state : null;
}

/** 协调只读元数据与文件预览，成功时一次发布样本和初始映射；从不执行或重试数据库写入。 */
export class ImportPreviewController {
  private generation = 0;
  private state: ImportPreviewState = null;
  private readonly metadata = new Map<string, Promise<TableInfo>>();

  /** 依赖由桌面接口提供，状态监听只接收原子快照，便于复现响应先后顺序。 */
  constructor(private readonly dependencies: PreviewDependencies, private readonly publish: (state: ImportPreviewState) => void) {}

  /** 切换上下文先失效旧请求，待当前目标元数据成功后才读取一次文件预览。 */
  async prepare(context: ImportPreviewContext | null): Promise<void> {
    if (context && readyImportPreview(this.state, context)) return;
    const generation = ++this.generation;
    if (!context) { this.update(null); return; }
    const key = importPreviewKey(context); this.update({ key, status: 'loading' });
    try {
      const info = await this.metadataFor(context);
      if (generation !== this.generation) return;
      const sample = await this.dependencies.preview(context);
      if (generation !== this.generation) return;
      const targets = new Set(info.columns.filter(column => !column.generated).map(column => column.name));
      const mapping = Object.fromEntries(sample.columns.map(name => [name, targets.has(name) ? name : '']));
      this.update({ key, status: 'ready', info, sample, mapping });
    } catch (reason) {
      if (generation === this.generation) this.update({ key, status: 'failed', error: reason instanceof Error ? reason.message : String(reason) });
    }
  }

  /** 组件卸载或参数切换后丢弃迟到响应；只读请求自然结束，不触发新的网络请求。 */
  cancel(): void { this.generation++; }

  /** 人工映射仅更新当前已就绪的快照，不重新请求元数据或文件预览。 */
  setMapping(context: ImportPreviewContext, source: string, target: string): void {
    const current = readyImportPreview(this.state, context);
    if (!current || !Object.hasOwn(current.mapping, source)) return;
    if (target !== '' && !current.info.columns.some(column => column.name === target && !column.generated)) return;
    this.update({ ...current, mapping: { ...current.mapping, [source]: target } });
  }

  /** 执行入口再次读取协调器当前快照，避免界面刚切换时引用旧样本或旧映射。 */
  ready(context: ImportPreviewContext | null): ReadyImportPreview | null { return readyImportPreview(this.state, context); }

  /** 相同目标共享尚未完成的元数据请求；失败移除缓存，下一次显式选文件时可重新读取。 */
  private metadataFor(target: ImportPreviewTarget): Promise<TableInfo> {
    const key = targetKey(target); const pending = this.metadata.get(key);
    if (pending) return pending;
    const request = this.dependencies.metadata({ connectionId: target.connectionId, database: target.database, table: target.table }).catch(reason => {
      if (this.metadata.get(key) === request) this.metadata.delete(key);
      throw reason;
    });
    this.metadata.set(key, request); return request;
  }

  /** 样本、映射、目标标识和就绪状态一并更新，不能出现样本新而映射旧的中间状态。 */
  private update(state: ImportPreviewState): void { this.state = state; this.publish(state); }
}
