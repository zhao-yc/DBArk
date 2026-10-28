import type { DataRow, TableInfo } from '../shared/contracts';
import { csvImportDelimiter, csvImportHasHeader, type CsvImportDelimiter } from '../shared/csvImport';
import { importPresetConfigurationSchema, type ImportPresetConfiguration } from '../shared/importPresets';
import { importPresetsZh } from './locales/importPresets.zh-CN';

export interface ImportPreviewTarget { connectionId: string; database: string; table: string; }
export interface ImportPreviewContext extends ImportPreviewTarget {
  fileToken: string; format: 'csv' | 'json'; encoding: 'utf8' | 'utf16le' | 'gb18030';
  csvDelimiter?: CsvImportDelimiter;
  csvHasHeader?: boolean;
}
export interface ImportSample { columns: string[]; rows: DataRow[]; }
export interface ReadyImportPreview { key: string; status: 'ready'; info: TableInfo; sample: ImportSample; mapping: Record<string, string>; }
export type ImportPreviewState = ReadyImportPreview | { key: string; status: 'loading' } | { key: string; status: 'failed'; error: string } | null;
interface PreviewDependencies {
  metadata: (target: ImportPreviewTarget) => Promise<TableInfo>;
  preview: (context: ImportPreviewContext) => Promise<ImportSample>;
}
export interface ImportPreviewPreparation { freshMetadata?: boolean; configuration?: ImportPresetConfiguration; initialMapping?: Readonly<Record<string,string>>; sourceColumns?: readonly string[]; }

/** 具名字段按完整集合对齐，无标题字段按原列位置；所有目标通过后才整份发布。 */
function completeMapping(info: TableInfo, sample: ImportSample, configuration: ImportPresetConfiguration): Record<string, string> {
  const value = importPresetConfigurationSchema.parse(configuration), targets = new Set(info.columns.filter(column => !column.generated).map(column => column.name));
  const positional = value.format === 'csv' && !csvImportHasHeader(value.format, value.csvHasHeader), names = new Set(value.columns);
  const same = positional ? JSON.stringify(sample.columns) === JSON.stringify(value.columns) : sample.columns.length === value.columns.length && new Set(sample.columns).size === sample.columns.length && sample.columns.every(name => names.has(name));
  if (!same || Object.values(value.mapping).some(target => target && !targets.has(target))) throw Error(importPresetsZh.incompatible);
  return Object.fromEntries(sample.columns.map(name => [name, value.mapping[name]]));
}

/** 元数据只按目标缓存，文件、格式、编码、分隔符和标题设置另行组成预览标识。 */
function targetKey(target: ImportPreviewTarget): string { return JSON.stringify([target.connectionId, target.database, target.table]); }

/** 使用结构化键避免名称分隔符碰撞；就绪判断在渲染阶段完成，不等待副作用失效旧状态。 */
export function importPreviewKey(context: ImportPreviewContext): string {
  return JSON.stringify([context.connectionId, context.database, context.table, context.fileToken, context.format, context.encoding, csvImportDelimiter(context.format, context.csvDelimiter), csvImportHasHeader(context.format, context.csvHasHeader)]);
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
  async prepare(context: ImportPreviewContext | null, options: ImportPreviewPreparation = {}): Promise<void> {
    if (context && !options.freshMetadata && !options.configuration && !options.initialMapping && !options.sourceColumns && readyImportPreview(this.state, context)) return;
    const generation = ++this.generation;
    if (!context) { this.update(null); return; }
    const key = importPreviewKey(context); this.update({ key, status: 'loading' });
    try {
      const configuration = options.configuration ? importPresetConfigurationSchema.parse(options.configuration) : undefined;
      // 来源列来自完整inspect，而不是有限样本或mapping的键；首await前独立复制以固定原准备意图。
      const initialMapping = options.initialMapping === undefined ? undefined : Object.fromEntries(Object.entries(options.initialMapping));
      const sourceColumns = options.sourceColumns === undefined ? undefined : [...options.sourceColumns];
      if (sourceColumns && (!sourceColumns.length || new Set(sourceColumns).size !== sourceColumns.length || sourceColumns.some(name => typeof name !== 'string'))) throw Error(importPresetsZh.incompatible);
      if (configuration && (initialMapping || sourceColumns)) throw Error(importPresetsZh.incompatible);
      if (configuration && (configuration.format !== context.format || configuration.encoding !== context.encoding || csvImportDelimiter(context.format, configuration.csvDelimiter) !== csvImportDelimiter(context.format, context.csvDelimiter) || csvImportHasHeader(context.format, configuration.csvHasHeader) !== csvImportHasHeader(context.format, context.csvHasHeader))) throw Error(importPresetsZh.incompatible);
      const info = await this.metadataFor(context, !!options.freshMetadata);
      if (generation !== this.generation) return;
      if ((configuration || initialMapping || sourceColumns) && (info.database !== context.database || info.name !== context.table)) throw Error(importPresetsZh.incompatible);
      const limited = await this.dependencies.preview(context);
      if (generation !== this.generation) return;
      if (sourceColumns && limited.columns.some(name => !sourceColumns.includes(name))) throw Error(importPresetsZh.incompatible);
      const sample = sourceColumns ? { ...limited, columns: sourceColumns } : limited;
      const targets = new Set(info.columns.filter(column => !column.generated).map(column => column.name));
      // 无标题CSV的源键仅表示列位置，即便目标恰好也叫“第1列”仍必须人工映射。
      const automatic = context.format !== 'csv' || csvImportHasHeader(context.format, context.csvHasHeader);
      const mapping = configuration ? completeMapping(info, sample, configuration) : Object.fromEntries(sample.columns.map(name => [name, initialMapping !== undefined ? Object.hasOwn(initialMapping,name) && targets.has(initialMapping[name]) ? initialMapping[name] : '' : automatic && targets.has(name) ? name : '']));
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

  /** 原就绪对象与完整配置同时核验，失败撤销整份ready，绝不保留自动映射继续导入。 */
  applyMapping(context: ImportPreviewContext, expected: ReadyImportPreview, configuration: ImportPresetConfiguration): boolean {
    if (this.ready(context) !== expected) return false;
    try { if (configuration.format !== context.format || configuration.encoding !== context.encoding || csvImportDelimiter(context.format, configuration.csvDelimiter) !== csvImportDelimiter(context.format, context.csvDelimiter) || csvImportHasHeader(context.format, configuration.csvHasHeader) !== csvImportHasHeader(context.format, context.csvHasHeader)) throw Error(importPresetsZh.incompatible); const mapping = completeMapping(expected.info, expected.sample, configuration); this.update({ ...expected, mapping }); return true; }
    catch (reason) { this.update({ key: expected.key, status: 'failed', error: reason instanceof Error ? reason.message : String(reason) }); return false; }
  }

  /** 执行入口再次读取协调器当前快照，避免界面刚切换时引用旧样本或旧映射。 */
  ready(context: ImportPreviewContext | null): ReadyImportPreview | null { return readyImportPreview(this.state, context); }

  /** 相同目标共享尚未完成的元数据请求；失败移除缓存，下一次显式选文件时可重新读取。 */
  private metadataFor(target: ImportPreviewTarget, fresh = false): Promise<TableInfo> {
    const key = targetKey(target); const pending = this.metadata.get(key);
    if (pending && !fresh) return pending;
    if (fresh) this.metadata.delete(key);
    const request = this.dependencies.metadata({ connectionId: target.connectionId, database: target.database, table: target.table }).catch(reason => {
      if (this.metadata.get(key) === request) this.metadata.delete(key);
      throw reason;
    });
    // 强制核验不写正常缓存，旧默认读取与本次独立核验互不覆盖。
    if (!fresh) this.metadata.set(key, request); return request;
  }

  /** 样本、映射、目标标识和就绪状态一并更新，不能出现样本新而映射旧的中间状态。 */
  private update(state: ImportPreviewState): void { this.state = state; this.publish(state); }
}
