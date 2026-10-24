import { importPresetConfigurationSchema, importPresetDeleteSchema, importPresetSaveSchema, importPresetSnapshotSchema, type ImportPresetConfiguration, type ImportPresetDeleteInput, type ImportPresetSaveInput, type ImportPresetSnapshot } from '../shared/importPresets';
import { readyImportPreview, type ImportPreviewContext, type ReadyImportPreview } from './importPreview';
import { importPresetsZh as text } from './locales/importPresets.zh-CN';

/** 逐项白名单生成配置，不把预览行、目标连接或文件令牌带入本地存储。 */
export function captureImportPresetConfiguration(context: ImportPreviewContext | null, ready: ReadyImportPreview | null): ImportPresetConfiguration {
  if (!context || !ready || readyImportPreview(ready, context) !== ready) throw Error(text.unavailable);
  const targets = new Set(ready.info.columns.filter(column => !column.generated).map(column => column.name));
  if (Object.values(ready.mapping).some(target => target && !targets.has(target))) throw Error(text.incompatible);
  return importPresetConfigurationSchema.parse({ format: context.format, encoding: context.encoding, ...(context.format === 'csv' && context.csvDelimiter !== undefined ? { csvDelimiter: context.csvDelimiter } : {}), ...(context.format === 'csv' && context.csvHasHeader !== undefined ? { csvHasHeader: context.csvHasHeader } : {}), columns: [...ready.sample.columns], mapping: { ...ready.mapping } });
}
export interface ImportPresetsServices { list(): Promise<ImportPresetSnapshot>; save(input: ImportPresetSaveInput): Promise<ImportPresetSnapshot>; delete(input: ImportPresetDeleteInput): Promise<ImportPresetSnapshot>; }
export interface ImportPresetsState { snapshot?: ImportPresetSnapshot; selected: string; name: string; busy: boolean; error: string; needsRefresh: boolean; }
interface Options { services: ImportPresetsServices; source(): unknown; available(): boolean; capture(): ImportPresetConfiguration; apply(value: ImportPresetConfiguration): boolean; activity(delta: 1 | -1): void; publish(state: ImportPresetsState): void; }

/** CAS只携带用户已见修订；迟到或冲突必须显式刷新，不重试写盘或拼接成功结果。 */
export class ImportPresetsController {
  #state: ImportPresetsState = { selected: '', name: '', busy: false, error: '', needsRefresh: false };
  #alive = true; #operation?: object;
  constructor(private readonly options: Options) {}
  get state(): ImportPresetsState { return this.#state; }
  private publish(value: ImportPresetsState): void { this.#state = value; if (this.#alive) this.options.publish(value); }
  private current(expected: ImportPresetsState, source: unknown): boolean { return this.#alive && this.#state === expected && source === this.options.source() && !this.#operation && this.options.available(); }
  select(id: string, expected = this.#state, source = this.options.source()): void { if (!this.current(expected, source)) return; const entry = expected.snapshot?.entries.find(item => item.id === id); this.publish({ ...expected, selected: entry?.id ?? '', name: entry?.name ?? '', error: '' }); }
  rename(name: string, expected = this.#state, source = this.options.source()): void { if (this.current(expected, source)) this.publish({ ...expected, name, error: '' }); }
  /** 选择本身不恢复格式、不读取文件，更不导入；只有显式应用才交父级。 */
  apply(expected = this.#state, source = this.options.source()): void {
    if (!this.current(expected, source) || expected.needsRefresh) return; const entry = expected.snapshot?.entries.find(item => item.id === expected.selected); if (!entry) return;
    try { this.options.apply(importPresetConfigurationSchema.parse(entry.configuration)); } catch (reason) { this.publish({ ...expected, error: reason instanceof Error ? reason.message : String(reason) }); }
  }
  async load(expected = this.#state, source = this.options.source()): Promise<void> { if (!this.current(expected, source)) return; await this.run('list', expected); }
  async mutate(kind: 'create' | 'update' | 'delete', expected = this.#state, source = this.options.source()): Promise<void> {
    if (!this.current(expected, source) || expected.needsRefresh || !expected.snapshot || kind !== 'create' && !expected.selected) return;
    await this.run(kind, expected);
  }
  /** 异步占用在首次await前同步取得；离开后仍等原调用终结，不能假装取消本地写盘。 */
  private async run(kind: 'list' | 'create' | 'update' | 'delete', expected: ImportPresetsState): Promise<void> {
    const source = this.options.source(), token = {}; let input: ImportPresetSaveInput | ImportPresetDeleteInput | undefined;
    try {
      if ((kind === 'create' || kind === 'update') && (!expected.name.trim() || expected.name !== expected.name.trim() || expected.name.length > 80 || /[\u0000-\u001f\u007f-\u009f]/u.test(expected.name))) throw Error(text.invalidName);
      if (kind !== 'list') { const scope = { generation: expected.snapshot!.generation, revision: expected.snapshot!.revision };
        input = kind === 'delete' ? importPresetDeleteSchema.parse({ ...scope, id: expected.selected }) : importPresetSaveSchema.parse({ ...scope, ...(kind === 'update' ? { id: expected.selected } : {}), name: expected.name, configuration: this.options.capture() }); }
    } catch (reason) { this.publish({ ...expected, error: reason instanceof Error ? reason.message : String(reason) }); return; }
    this.#operation = token;
    try { this.options.activity(1); } catch (reason) { this.#operation = undefined; this.publish({ ...expected, error: reason instanceof Error ? reason.message : String(reason) }); return; }
    this.publish({ ...expected, busy: true, error: '' });
    try {
      const raw = kind === 'list' ? await this.options.services.list() : kind === 'delete' ? await this.options.services.delete(input as ImportPresetDeleteInput) : await this.options.services.save(input as ImportPresetSaveInput);
      const snapshot = importPresetSnapshotSchema.parse(raw);
      if (!this.#alive || this.#operation !== token) return;
      if (source !== this.options.source() || !this.options.available()) { this.publish({ ...this.#state, needsRefresh: true, error: text.refreshRequired }); return; }
      const id = kind === 'create' ? snapshot.entries.find(entry => entry.name === expected.name)?.id ?? '' : kind === 'delete' ? '' : expected.selected, entry = snapshot.entries.find(item => item.id === id);
      this.publish({ snapshot, selected: entry?.id ?? '', name: entry?.name ?? (kind === 'delete' ? '' : expected.name), busy: true, error: '', needsRefresh: false });
    } catch (reason) { if (this.#alive && this.#operation === token) this.publish({ ...this.#state, needsRefresh: true, error: text.refreshRequired + ' ' + (reason instanceof Error ? reason.message : String(reason)) }); }
    finally { if (this.#operation === token) { this.#operation = undefined; this.options.activity(-1); if (this.#alive) this.publish({ ...this.#state, busy: false }); } }
  }
  dispose(): void { this.#alive = false; }
}
