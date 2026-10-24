import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { TableInfo } from '../../src/shared/contracts';
import type { ImportPresetConfiguration, ImportPresetSnapshot } from '../../src/shared/importPresets';
import { ImportPreviewController, type ImportPreviewContext, type ImportSample } from '../../src/renderer/importPreview';
import { ImportPresetsController, captureImportPresetConfiguration, type ImportPresetsServices } from '../../src/renderer/importPresetsUi';
import { importPresetsZh as text } from '../../src/renderer/locales/importPresets.zh-CN';
const configuration = (): ImportPresetConfiguration => ({ format: 'csv', encoding: 'gb18030', csvDelimiter: ';', csvHasHeader: false, columns: ['第1列', '第2列'], mapping: { 第1列: 'id', 第2列: '' } });
const context: ImportPreviewContext = { connectionId: '不保存的连接', database: '不保存的库', table: 't', fileToken: '不保存的令牌', format: 'csv', encoding: 'gb18030', csvDelimiter: ';', csvHasHeader: false };
const sample: ImportSample = { columns: ['第1列', '第2列'], rows: [{ 第1列: '首条秘密数据', 第2列: '原文' }] };
const info = (database = context.database): TableInfo => ({ database, name: 't', engine: 'InnoDB', columns: ['id', 'body', 'generated'].map(name => ({ name, type: 'text', nullable: true, generated: name === 'generated', defaultValue: null, extra: '', comment: '' })), primaryKey: [], editableKey: [], indexes: [], foreignKeys: [], ddl: '不保存的DDL' });
const id = randomUUID(), generation = randomUUID(), time = '2026-10-24T00:00:00.000Z';
const snapshot = (revision = 1): ImportPresetSnapshot => ({ generation, revision, entries: [{ id, name: '常用 导入', configuration: configuration(), createdAt: time, updatedAt: time }] });
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture(overrides: Partial<ImportPresetsServices> = {}) {
  let source = '来源1'; const activity = vi.fn(), apply = vi.fn(() => true), capture = vi.fn(configuration), publish = vi.fn();
  const services: ImportPresetsServices = { list: vi.fn(async () => snapshot()), save: vi.fn(async () => snapshot(2)), delete: vi.fn(async () => ({ generation, revision: 2, entries: [] })), ...overrides };
  const controller = new ImportPresetsController({ services, source: () => source, available: () => true, capture, apply, activity, publish }); return { controller, services, activity, apply, capture, publish, source(value: string) { source = value; } };
}
describe('导入配置协调器与整份应用（纯RAM）', () => {
  it('当前ready按白名单保存false及跳过字段，不保存行/令牌/连接/数据库/DDL', async () => {
    const controller = new ImportPreviewController({ metadata: async () => info(), preview: async () => sample }, () => {}); await controller.prepare(context); controller.setMapping(context, '第1列', 'id'); const value = captureImportPresetConfiguration(context, controller.ready(context));
    expect(value).toEqual(configuration()); expect(Object.keys(value).sort()).toEqual(['columns', 'csvDelimiter', 'csvHasHeader', 'encoding', 'format', 'mapping']); expect(JSON.stringify(value)).not.toMatch(/首条秘密数据|不保存的|fileToken|connectionId|database|ddl/);
    expect(() => captureImportPresetConfiguration({ ...context, fileToken: '其它文件' }, controller.ready(context))).toThrow(); controller.setMapping(context, '第1列', ''); expect(() => captureImportPresetConfiguration(context, controller.ready(context))).toThrow();
  });
  it('JSON配置没有任何CSV自有字段，完整映射不可重复或映射生成列', async () => {
    const json: ImportPreviewContext = { ...context, format: 'json' }; delete json.csvDelimiter; delete json.csvHasHeader;
    const controller = new ImportPreviewController({ metadata: async () => info(), preview: async () => ({ columns: ['id', 'body'], rows: [{ id: '1', body: '内容' }] }) }, () => {}); await controller.prepare(json);
    const captured = captureImportPresetConfiguration(json, controller.ready(json)); expect(captured).not.toHaveProperty('csvDelimiter'); expect(captured).not.toHaveProperty('csvHasHeader'); controller.setMapping(json, 'body', 'id'); expect(() => captureImportPresetConfiguration(json, controller.ready(json))).toThrow();
  });
  it('明确应用强制独立metadata，不让旧缓存冒充新结构；缺字段整份失败无默认映射', async () => {
    const changed = info(); changed.columns = changed.columns.filter(column => column.name !== 'id'); const metadata = vi.fn().mockResolvedValueOnce(info()).mockResolvedValueOnce(changed);
    const controller = new ImportPreviewController({ metadata, preview: async () => sample }, () => {}); await controller.prepare(context); await controller.prepare(context, { freshMetadata: true, configuration: configuration() }); expect(metadata).toHaveBeenCalledTimes(2); expect(controller.ready(context)).toBeNull();
  });
  it.each(['order', 'extra', 'generated'] as const)('有序源列或目标%s不兼容时整份映射拒绝，不发写入', async kind => {
    const currentSample = kind === 'order' ? { ...sample, columns: [...sample.columns].reverse() } : kind === 'extra' ? { ...sample, columns: [...sample.columns, '额外列'] } : sample;
    const config = configuration(); if (kind === 'generated') config.mapping.第1列 = 'generated'; const published = vi.fn(), controller = new ImportPreviewController({ metadata: async () => info(), preview: async () => currentSample }, published);
    await controller.prepare(context, { freshMetadata: true, configuration: config }); expect(controller.ready(context)).toBeNull(); expect(published.mock.calls.at(-1)?.[0]).toMatchObject({ status: 'failed', error: text.incompatible });
  });
  it.each(['csv', 'json'] as const)('%s具名字段完整集合允许重排列，映射按当前字段序发布', async format => {
    const config: ImportPresetConfiguration = { format, encoding: 'utf8', columns: ['id', 'body'], mapping: { id: 'id', body: 'body' } }, source: ImportPreviewContext = { connectionId: 'c', database: 'db', table: 't', fileToken: 'f', format, encoding: 'utf8' };
    const controller = new ImportPreviewController({ metadata: async () => info(source.database), preview: async () => ({ columns: ['body', 'id'], rows: [{ body: '首条', id: '1' }] }) }, () => {});
    await controller.prepare(source, { freshMetadata: true, configuration: config }); expect(Object.keys(controller.ready(source)!.mapping)).toEqual(['body', 'id']); expect(controller.ready(source)?.mapping).toEqual({ body: 'body', id: 'id' });
  });
  it.each([{ columns: ['id'] }, { columns: ['id', 'body', 'extra'] }, { columns: ['id', 'id'] }])('具名字段缺失/新增/重复%j均整份拒绝', async ({ columns }) => {
    const config: ImportPresetConfiguration = { format: 'json', encoding: 'utf8', columns: ['id', 'body'], mapping: { id: 'id', body: 'body' } }, source: ImportPreviewContext = { connectionId: 'c', database: 'db', table: 't', fileToken: 'f', format: 'json', encoding: 'utf8' }, controller = new ImportPreviewController({ metadata: async () => info(source.database), preview: async () => ({ columns, rows: [] }) }, () => {});
    await controller.prepare(source, { freshMetadata: true, configuration: config }); expect(controller.ready(source)).toBeNull();
  });
  it.each([false, true])('同选项反复应用也独立读取metadata，旧成功/失败不能污染最新整份映射（旧失败=%s）', async fail => {
    const old = deferred<TableInfo>(), metadata = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce(info()), controller = new ImportPreviewController({ metadata, preview: async () => sample }, () => {}), a = controller.prepare(context, { freshMetadata: true, configuration: configuration() });
    const latest = { ...configuration(), mapping: { 第1列: 'body', 第2列: '' } }; await controller.prepare(context, { freshMetadata: true, configuration: latest }); if (fail) old.reject(Error('旧结构失败')); else old.resolve(info()); await a;
    expect(metadata).toHaveBeenCalledTimes(2); expect(controller.ready(context)?.mapping).toEqual(latest.mapping);
  });
  it('applyMapping核原ready对象，整份成功后原子更新；未知目标失败撤销ready', async () => {
    const controller = new ImportPreviewController({ metadata: async () => info(), preview: async () => sample }, () => {}); await controller.prepare(context); const ready = controller.ready(context)!;
    expect(controller.applyMapping(context, { ...ready }, configuration())).toBe(false); expect(controller.applyMapping(context, ready, configuration())).toBe(true); expect(controller.ready(context)?.mapping).toEqual(configuration().mapping);
    expect(controller.applyMapping(context, controller.ready(context)!, { ...configuration(), mapping: { 第1列: 'missing', 第2列: '' } })).toBe(false); expect(controller.ready(context)).toBeNull();
  });
  it('选择不应用；显式应用配置没有调用save/delete或导入端口', async () => {
    const f = fixture(); expect(f.services.list).not.toHaveBeenCalled(); await f.controller.load(); f.controller.select(id); expect(f.apply).not.toHaveBeenCalled(); f.controller.apply(); expect(f.apply).toHaveBeenCalledExactlyOnceWith(configuration()); expect(f.services.save).not.toHaveBeenCalled(); expect(f.services.delete).not.toHaveBeenCalled();
  });
  it('新建/更新/删除只发所见generation/revision，名称保留内部空格；零映射不保存', async () => {
    const f = fixture(); await f.controller.load(); f.controller.select(id); await f.controller.mutate('update'); expect(f.services.save).toHaveBeenCalledExactlyOnceWith({ generation, revision: 1, id, name: '常用 导入', configuration: configuration() }); await f.controller.mutate('delete'); expect(f.services.delete).toHaveBeenCalledExactlyOnceWith({ generation, revision: 2, id });
    await f.controller.load(); f.controller.rename('新配置'); f.capture.mockReturnValue({ ...configuration(), mapping: { 第1列: '', 第2列: '' } }); await f.controller.mutate('create'); expect(f.services.save).toHaveBeenCalledOnce();
  });
  it.each(['list', 'save', 'delete'] as const)('%s迟到回包在来源换代后仅提示刷新，不能安装旧列表或重试', async command => {
    const held = deferred<ImportPresetSnapshot>(), f = fixture(); await f.controller.load(); f.controller.select(id); const original = f.controller.state.snapshot;
    if (command === 'list') f.services.list = vi.fn(() => held.promise); else if (command === 'save') f.services.save = vi.fn(() => held.promise); else f.services.delete = vi.fn(() => held.promise);
    const pending = command === 'list' ? f.controller.load() : f.controller.mutate(command === 'save' ? 'update' : 'delete'); f.source('来源2'); held.resolve(snapshot(90)); await pending; expect(f.controller.state.snapshot).toBe(original); expect(f.controller.state.needsRefresh).toBe(true); expect(f.controller.state.error).toContain(text.refreshRequired); expect(f.activity.mock.calls.at(-1)).toEqual([-1]);
  });
  it('CAS失败显式刷新才能重试，旧操作回调在ABA后不能消费新来源', async () => {
    const f = fixture({ save: vi.fn(async () => { throw Error('修订冲突'); }) }); await f.controller.load(); f.controller.select(id); const before = f.controller.state; await f.controller.mutate('update'); expect(f.controller.state.needsRefresh).toBe(true); await f.controller.mutate('update'); expect(f.services.save).toHaveBeenCalledOnce(); await f.controller.load();
    f.source('来源2'); await f.controller.mutate('update', before, '来源1'); f.source('来源3'); await f.controller.mutate('update', f.controller.state, '来源1'); expect(f.services.save).toHaveBeenCalledOnce();
  });
});
