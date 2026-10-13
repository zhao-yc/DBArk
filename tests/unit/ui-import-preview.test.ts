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
