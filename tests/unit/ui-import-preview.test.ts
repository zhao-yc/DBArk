import { describe, expect, it, vi } from 'vitest';
import type { TableInfo } from '../../src/shared/contracts';
import { ImportPreviewController, importPreviewKey, readyImportPreview, type ImportPreviewContext, type ImportPreviewState, type ImportSample } from '../../src/renderer/importPreview';

const context: ImportPreviewContext = { connectionId: '开发连接', database: 'app', table: 'items', fileToken: '文件一', format: 'json', encoding: 'utf8' };
const sample: ImportSample = { columns: ['id', 'content', 'computed'], rows: [{ id: '18446744073709551615', content: '保留中文,逗号', computed: '忽略生成列' }] };

/** 手工控制响应顺序，不通过睡眠或实际重试写入制造测试时序。 */
function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((success, failure) => { resolve = success; reject = failure; });
  return { promise, resolve, reject };
}

/** 精简但完整的真实元数据形状，同时覆盖自动映射排除生成列的边界。 */
function tableInfo(table = 'items'): TableInfo {
  return { database: 'app', name: table, engine: 'InnoDB', columns: ['id', 'content', 'computed'].map(name => ({ name, type: 'varchar(100)', nullable: true, defaultValue: null, extra: '', comment: '', generated: name === 'computed' })), indexes: [], foreignKeys: [], primaryKey: ['id'], editableKey: ['id'], ddl: '' };
}

describe('文件导入预览的异步上下文', () => {
  it('CSV标题默认兼容，关闭后预览身份不同，位置源键即使与目标同名也绝不自动映射', async () => {
    const csv: ImportPreviewContext = { ...context, format: 'csv' }, positional = { ...csv, csvHasHeader: false };
    expect(importPreviewKey(csv)).toBe(importPreviewKey({ ...csv, csvHasHeader: true })); expect(importPreviewKey(csv)).not.toBe(importPreviewKey(positional));
    const positionalSample: ImportSample = { columns: ['第1列', '第2列'], rows: [{ 第1列: '首条数据', 第2列: '' }, { 第1列: '第二条', 第2列: '原文\n换行' }] };
    const info = tableInfo(); info.columns.push({ ...info.columns[0], name: '第1列' });
    const preview = vi.fn(async () => positionalSample), controller = new ImportPreviewController({ metadata: async () => info, preview }, () => {});
    await controller.prepare(positional); expect(preview).toHaveBeenCalledExactlyOnceWith(positional); expect(controller.ready(positional)?.mapping).toEqual({ 第1列: '', 第2列: '' });
    expect(controller.ready(csv)).toBeNull(); controller.setMapping(positional, '第1列', 'id'); controller.setMapping(positional, '第2列', 'content');
    expect(controller.ready(positional)?.mapping).toEqual({ 第1列: 'id', 第2列: 'content' }); expect(controller.ready(positional)?.sample.rows[0]).toEqual({ 第1列: '首条数据', 第2列: '' });
  });
  it.each([false, true])('标题A→B→A保留最终预览，旧成功/失败不能覆盖（旧A失败=%s）', async failFirst => {
    const csv: ImportPreviewContext = { ...context, format: 'csv' }, first = deferred<ImportSample>(), second = deferred<ImportSample>(), third = deferred<ImportSample>();
    const preview = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise), controller = new ImportPreviewController({ metadata: async () => tableInfo(), preview }, () => {});
    const a = controller.prepare(csv); await Promise.resolve(); await Promise.resolve(); const b = controller.prepare({ ...csv, csvHasHeader: false }); await Promise.resolve(); await Promise.resolve(); const c = controller.prepare(csv); await Promise.resolve(); await Promise.resolve();
    third.resolve(sample); await c; controller.setMapping(csv, 'content', 'id');
    if (failFirst) { first.reject(Error('旧标题失败')); second.resolve({ columns: ['旧位置'], rows: [] }); } else { first.resolve({ columns: ['旧标题'], rows: [] }); second.reject(Error('旧位置失败')); }
    await Promise.all([a, b]); expect(controller.ready(csv)?.sample).toEqual(sample); expect(controller.ready(csv)?.mapping.content).toBe('id'); expect(preview).toHaveBeenCalledTimes(3);
  });
  it('分隔符属于预览身份，省略与显式逗号兼容，换参数即失效人工映射', async () => {
    const csv: ImportPreviewContext = { ...context, format: 'csv' };
    expect(importPreviewKey(csv)).toBe(importPreviewKey({ ...csv, csvDelimiter: ',' }));
    expect(importPreviewKey(csv)).not.toBe(importPreviewKey({ ...csv, csvDelimiter: ';' }));
    expect(importPreviewKey({ ...csv, csvDelimiter: ';' })).not.toBe(importPreviewKey({ ...csv, csvDelimiter: '\t' }));
    const delayed = deferred<ImportSample>();
    const controller = new ImportPreviewController({ metadata: async () => tableInfo(), preview: input => input.csvDelimiter === ';' ? delayed.promise : Promise.resolve(sample) }, () => {});
    await controller.prepare(csv); controller.setMapping(csv, 'content', 'id');
    const next = { ...csv, csvDelimiter: ';' as const };
    // 副作用尚未运行时，按当前上下文检查已经不能执行旧快照。
    expect(controller.ready(next)).toBeNull();
    const pending = controller.prepare(next); expect(controller.ready(csv)).toBeNull();
    delayed.resolve(sample); await pending;
    expect(controller.ready(next)?.mapping).toEqual({ id: 'id', content: 'content', computed: '' });
  });

  it('分隔符逗号到分号再到逗号，迟到的第一轮不能覆盖最终样本与映射', async () => {
    const csv = { ...context, format: 'csv' as const, csvDelimiter: ',' as const };
    const first = deferred<ImportSample>(), second = deferred<ImportSample>(), third = deferred<ImportSample>();
    const preview = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise);
    const controller = new ImportPreviewController({ metadata: async () => tableInfo(), preview }, () => {});
    const a = controller.prepare(csv); await Promise.resolve(); await Promise.resolve();
    expect(preview).toHaveBeenCalledTimes(1);
    const b = controller.prepare({ ...csv, csvDelimiter: ';' }); await Promise.resolve(); await Promise.resolve();
    const c = controller.prepare(csv); await Promise.resolve(); await Promise.resolve();
    expect(preview).toHaveBeenCalledTimes(3);
    third.resolve(sample); await c; controller.setMapping(csv, 'content', 'id');
    first.resolve({ columns: ['旧逗号'], rows: [] }); second.resolve({ columns: ['旧分号'], rows: [] }); await Promise.all([a, b]);
    expect(controller.ready(csv)?.sample).toEqual(sample); expect(controller.ready(csv)?.mapping.content).toBe('id');
  });

  it('元数据晚到时没有空映射首轮预览，就绪样本与映射一次发布', async () => {
    const metadata = deferred<TableInfo>(); const preview = vi.fn().mockResolvedValue(sample); const published: ImportPreviewState[] = [];
    const controller = new ImportPreviewController({ metadata: () => metadata.promise, preview }, state => published.push(state));
    const pending = controller.prepare(context);
    expect(preview).not.toHaveBeenCalled(); expect(controller.ready(context)).toBeNull();
    expect(published).toEqual([{ key: importPreviewKey(context), status: 'loading' }]);
    metadata.resolve(tableInfo()); await pending;
    expect(preview).toHaveBeenCalledExactlyOnceWith(context);
    expect(published).toHaveLength(2);
    expect(controller.ready(context)?.mapping).toEqual({ id: 'id', content: 'content', computed: '' });
    expect(controller.ready(context)?.sample.rows[0].id).toBe('18446744073709551615');
  });

  it('同一目标元数据仍在加载时换文件，只预览最终选择的文件', async () => {
    const metadata = deferred<TableInfo>(); const readMetadata = vi.fn(() => metadata.promise); const preview = vi.fn().mockResolvedValue(sample);
    const controller = new ImportPreviewController({ metadata: readMetadata, preview }, () => {});
    const first = controller.prepare(context); const next = { ...context, fileToken: '文件二' }; const second = controller.prepare(next);
    metadata.resolve(tableInfo()); await Promise.all([first, second]);
    expect(readMetadata).toHaveBeenCalledTimes(1);
    expect(preview).toHaveBeenCalledExactlyOnceWith(next);
    expect(controller.ready(context)).toBeNull(); expect(controller.ready(next)).not.toBeNull();
  });

  it('旧目标元数据迟到不触发旧文件预览，也不覆盖新目标字段', async () => {
    const oldMetadata = deferred<TableInfo>(); const newMetadata = deferred<TableInfo>(); const preview = vi.fn().mockResolvedValue(sample);
    const controller = new ImportPreviewController({ metadata: target => target.table === 'items' ? oldMetadata.promise : newMetadata.promise, preview }, () => {});
    const old = controller.prepare(context); const next = { ...context, table: 'other' }; const current = controller.prepare(next);
    newMetadata.resolve(tableInfo('other')); await current;
    oldMetadata.resolve(tableInfo()); await old;
    expect(preview).toHaveBeenCalledExactlyOnceWith(next);
    expect(controller.ready(next)?.info.name).toBe('other');
  });

  it('旧文件预览迟到不覆盖新预览及其人工映射', async () => {
    const oldPreview = deferred<ImportSample>(); const newPreview = deferred<ImportSample>();
    const oldStarted = deferred<void>(); const newStarted = deferred<void>();
    const preview = vi.fn((input: ImportPreviewContext) => {
      if (input.fileToken === context.fileToken) { oldStarted.resolve(); return oldPreview.promise; }
      newStarted.resolve(); return newPreview.promise;
    });
    const controller = new ImportPreviewController({ metadata: async () => tableInfo(), preview }, () => {});
    const first = controller.prepare(context); await oldStarted.promise;
    const next = { ...context, fileToken: '新文件' }; const second = controller.prepare(next); await newStarted.promise;
    newPreview.resolve({ columns: ['source'], rows: [{ source: '当前文件' }] }); await second;
    controller.setMapping(next, 'source', 'content');
    oldPreview.resolve(sample); await first;
    expect(controller.ready(next)?.mapping).toEqual({ source: 'content' });
    expect(controller.ready(next)?.sample.rows).toEqual([{ source: '当前文件' }]);
  });

  it('人工映射更新和同上下文准备不会重复预览或恢复自动映射', async () => {
    const metadata = vi.fn().mockResolvedValue(tableInfo()); const preview = vi.fn().mockResolvedValue(sample);
    const controller = new ImportPreviewController({ metadata, preview }, () => {});
    await controller.prepare(context); controller.setMapping(context, 'id', 'content'); controller.setMapping(context, 'content', '');
    await controller.prepare({ ...context });
    expect(controller.ready(context)?.mapping).toEqual({ id: 'content', content: '', computed: '' });
    expect(metadata).toHaveBeenCalledTimes(1); expect(preview).toHaveBeenCalledTimes(1);
    controller.setMapping(context, 'id', 'computed');
    expect(controller.ready(context)?.mapping.id).toBe('content');
  });

  it.each([
    { encoding: 'utf16le' as const }, { fileToken: '另一文件' }, { format: 'csv' as const },
    { connectionId: '另一连接' }, { database: 'another_db' }, { table: 'another_table' }
  ])('参数改变后即使副作用尚未运行，旧预览也不可见或导入：%j', patch => {
    const ready: ImportPreviewState = { key: importPreviewKey(context), status: 'ready', info: tableInfo(), sample, mapping: { id: 'id' } };
    expect(readyImportPreview(ready, { ...context, ...patch })).toBeNull();
    expect(readyImportPreview(ready, context)).toBe(ready);
  });

  it('编码预览失败不保留旧样本或映射，恢复编码后才允许当前文件继续', async () => {
    const preview = vi.fn().mockResolvedValueOnce(sample).mockRejectedValueOnce(new Error('文件无法按当前编码解析')).mockResolvedValueOnce(sample);
    const published: ImportPreviewState[] = [];
    const controller = new ImportPreviewController({ metadata: async () => tableInfo(), preview }, state => published.push(state));
    await controller.prepare(context); const wrongEncoding = { ...context, encoding: 'utf16le' as const };
    await controller.prepare(wrongEncoding);
    expect(published.at(-1)).toEqual({ key: importPreviewKey(wrongEncoding), status: 'failed', error: '文件无法按当前编码解析' });
    expect(controller.ready(wrongEncoding)).toBeNull(); expect(controller.ready(context)).toBeNull();
    await controller.prepare(context);
    expect(controller.ready(context)?.mapping.id).toBe('id'); expect(preview).toHaveBeenCalledTimes(3);
  });

  it('元数据失败时不读取文件，下一次明确重新选文件可重读元数据', async () => {
    const metadata = vi.fn().mockRejectedValueOnce(new Error('没有元数据权限')).mockResolvedValueOnce(tableInfo()); const preview = vi.fn().mockResolvedValue(sample);
    const controller = new ImportPreviewController({ metadata, preview }, () => {});
    await controller.prepare(context); expect(controller.ready(context)).toBeNull(); expect(preview).not.toHaveBeenCalled();
    const next = { ...context, fileToken: '重新选择的文件' }; await controller.prepare(next);
    expect(metadata).toHaveBeenCalledTimes(2); expect(controller.ready(next)).not.toBeNull();
  });

  it('导出或SQL导入无数据预览上下文，清空预览且不会请求元数据或文件', async () => {
    const metadata = vi.fn(); const preview = vi.fn(); const published = vi.fn();
    const controller = new ImportPreviewController({ metadata, preview }, published);
    await controller.prepare(null);
    expect(published).toHaveBeenCalledExactlyOnceWith(null);
    expect(metadata).not.toHaveBeenCalled(); expect(preview).not.toHaveBeenCalled(); expect(controller.ready(null)).toBeNull();
  });

  it('卸载后到达的预览结果被丢弃，不再发布就绪状态', async () => {
    const delayed = deferred<ImportSample>(); const started = deferred<void>(); const published = vi.fn();
    const controller = new ImportPreviewController({ metadata: async () => tableInfo(), preview: () => { started.resolve(); return delayed.promise; } }, published);
    const pending = controller.prepare(context); await started.promise; controller.cancel();
    const calls = published.mock.calls.length; delayed.resolve(sample); await pending;
    expect(published).toHaveBeenCalledTimes(calls); expect(controller.ready(context)).toBeNull();
  });
});
