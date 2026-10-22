import React, { act } from 'react';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { memoryDocument, MemoryEvent, MemoryNode } from '../fixtures/memory-dom';
import { parseTableColumnDefinition } from '../../src/engine/tableColumnDefinition';
import { columnPatchAccess, type TableColumnGetOutput, type TableColumnPreviewOutput } from '../../src/shared/tableColumnPatches';
import { columnPatchZh as text } from '../../src/renderer/locales/columnPatches.zh-CN';
import type { ColumnPatchServices } from '../../src/renderer/components/ColumnPatchDialog';

vi.mock('../../src/renderer/components/SqlEditor', () => ({ SqlEditor: ({ value, readOnly }: { value: string; readOnly: boolean }) => <pre aria-label="生成列只读SQL测试端口" data-read-only={String(readOnly)}>{value}</pre> }));
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined, ColumnPatchDialog: typeof import('../../src/renderer/components/ColumnPatchDialog')['ColumnPatchDialog'];
const keys = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'], globals = keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
beforeAll(async () => {
  document = memoryDocument(); (document as any).oninput = null; (window as any).confirm = () => true;
  const create = document.createElement.bind(document);
  document.createElement = (name: string) => {
    const node = create(name); if (name === 'input') node.type = 'text';
    // 仅补DOM端口的HTML属性反射，事件与组件状态仍由真实ReactDOM驱动。
    const set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node);
    node.setAttribute = (key, value) => { set(key, value); if (key === 'disabled') node.disabled = true; if (key === 'type') node.type = value; if (key === 'value' && name === 'option') node.value = value; };
    node.removeAttribute = key => { remove(key); if (key === 'disabled') node.disabled = false; };
    if (name === 'select') {
      Object.defineProperty(node, 'options', { get: () => node.querySelectorAll('option') });
      Object.defineProperty(node, 'value', { get: () => node.querySelectorAll('option').find(option => (option as MemoryNode & { selected?: boolean }).selected)?.value ?? '', set: value => { for (const option of node.querySelectorAll('option')) (option as MemoryNode & { selected?: boolean }).selected = option.value === value; } });
    }
    return node;
  };
  ({ createRoot } = await import('react-dom/client')); ({ ColumnPatchDialog } = await import('../../src/renderer/components/ColumnPatchDialog'));
});
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined; } });
afterAll(() => { for (const [key, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } });

/** 异步服务只作为RAM边界；生产组件、共享校验及React事件保持真实，绝不调用IPC或数据库。 */
async function mount(options: { access?: boolean; omitAccess?: boolean; version?: string; missingAck?: boolean; noSources?: boolean; preview?: () => Promise<TableColumnPreviewOutput>; apply?: ColumnPatchServices['apply'] } = {}) {
  const target = { connectionId: 'synthetic-generated', database: 'db', table: 't' };
  const model = parseTableColumnDefinition('CREATE TABLE t (`base` int NULL,`price` decimal(20,6) NULL,`odd``name` int NULL,`id` bigint NOT NULL AUTO_INCREMENT,`old_generated` int GENERATED ALWAYS AS (`base`+1) VIRTUAL,`title` varchar(30) NULL,`updated_at` DATETIME(6) NULL DEFAULT NULL) ENGINE=InnoDB', { dialect: 'mysql', mode: { ansiQuotes: false, noBackslashEscapes: false } });
  const version = options.version ?? '8.4.11';
  const snapshot: TableColumnGetOutput = {
    target, snapshotId: 'snapshot-generated', ddlHash: '原定义摘要', expiresAt: new Date(Date.now() + 300000).toISOString(),
    columns: model.columns.map(column => ({ columnRef: '内部引用-' + column.ordinal, name: column.name, ordinal: column.ordinal, typeSql: column.type.raw, nullable: column.nullable, default: column.default, comment: column.comment, rawDefinition: column.raw, access: columnPatchAccess(column, 'mysql', version), generatedReference: !options.noSources && ['base', 'price', 'odd`name'].includes(column.name) })),
    warnings: [], capabilities: { dialect: 'mysql', serverVersion: version, maxDecimalScale: 30 },
    ...(options.omitAccess ? {} : { generatedAccess: { editable: options.access !== false, ...(options.access === false ? { reason: '合成目录拒绝新增生成列' } : {}) } }),
  };
  const receipt: TableColumnPreviewOutput = { target, previewToken: 'preview-generated', expiresAt: snapshot.expiresAt, ddlHash: snapshot.ddlHash, sql: '-- 合成服务返回的只读预览，不代表实库SQL验收', changes: [], warnings: [], requiredAcknowledgements: ['ddl-implicit-commit', 'external-ddl-window', ...(options.missingAck ? [] : ['generated-column-computation'])], concurrencyPolicy: 'recheck-before-ddl' };
  const preview = vi.fn<ColumnPatchServices['preview']>(options.preview ?? (async () => receipt)), apply = vi.fn<ColumnPatchServices['apply']>(options.apply ?? (async () => ({ ddlSubmitted: true as const, ddlCompleted: true as const, definitionVerified: true, warnings: [] }))), release = vi.fn(async () => {}), cancel = vi.fn(async () => {}), close = vi.fn(), dirty = vi.fn();
  const services: ColumnPatchServices = { get: vi.fn(async () => snapshot), preview, apply, release, cancel };
  const noop = () => {}, props = { target, targetVersion: 1, services, onClose: close, onCleanupError: noop, onDirtyChange: dirty, onApplied: noop, beforeApply: noop, onExecutionUncertain: noop };
  const container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container as any);
  await act(async () => root!.render(<ColumnPatchDialog {...props}/>));
  return { snapshot, receipt, preview, apply, release, cancel, close, dirty, services, async revision(value: number) { await act(async () => root!.render(<ColumnPatchDialog {...props} targetVersion={value}/>)); } };
}
/** 按公开标签分派实际DOM事件，不调用组件内部setter或复制回调实现。 */
function button(label: string) { const node = document.body.querySelectorAll('button').find(node => node.textContent === label); expect(node, label).toBeDefined(); return node!; }
async function click(label: string) { const node = button(label); expect(node.disabled, label).toBe(false); await act(async () => node.dispatchEvent(new MemoryEvent('click'))); }
function field(label: string, kind = 'select') { const node = document.body.querySelectorAll(kind).find(node => node.getAttribute('aria-label') === label || node.parentNode?.textContent === label || kind === 'select' && node.parentNode?.textContent.startsWith(label)); expect(node, label).toBeDefined(); return node!; }
async function select(label: string, value: string) { const node = field(label); expect(node.disabled).toBe(false); await act(async () => { node.value = value; node.dispatchEvent(new MemoryEvent('change')); }); }
async function input(label: string, value: string, kind = 'input') { const node = field(label, kind); expect(node.disabled).toBe(false); await act(async () => { node.value = value; node.dispatchEvent(new MemoryEvent('input')); }); }
async function check(label: string) { const node = document.body.querySelectorAll('input').find(node => node.type === 'checkbox' && node.parentNode?.textContent === label); expect(node, label).toBeDefined(); expect(node!.disabled).toBe(false); await act(async () => { node!.checked = !node!.checked; node!.dispatchEvent(new MemoryEvent('click')); }); }
/** 公共控件完成一个尚未暂存的生成列草稿。 */
async function generated(expression = '`base` + 1') { await click(text.add); await select(text.fieldKind, 'generated'); await input(text.name, 'computed'); await input(text.generatedExpression, expression, 'textarea'); }

it.each(['VIRTUAL', 'STORED'] as const)('%s生成字段由真实控件暂存和预览，三项确认后只投递一次且不泄漏普通属性', async storage => {
  const f = await mount(); await generated(); await select(text.family, 'decimal'); await select(text.generatedStorage, storage); await click(text.rowSave);
  expect(f.preview).not.toHaveBeenCalled(); expect(f.apply).not.toHaveBeenCalled(); await click(text.edit); expect(field(text.generatedStorage).value).toBe(storage); expect(field(text.generatedExpression, 'textarea').value).toBe('`base` + 1'); await click(text.rowSave); await click(text.preview);
  const payload = f.preview.mock.calls[0][0]; expect(payload.patches).toHaveLength(1); expect(payload.patches[0]).toMatchObject({ kind: 'add', name: 'computed', type: { kind: 'decimal', precision: 10, scale: 0 }, nullable: true, default: { kind: 'none' }, position: { kind: 'last' }, generated: { storage, expression: '`base` + 1' } });
  expect(Object.hasOwn(payload.patches[0], 'onUpdate')).toBe(false); expect(Object.hasOwn(payload, 'sql')).toBe(false); expect(document.body.textContent).toContain(storage); expect(document.body.querySelector('pre[aria-label="' + text.generatedExpression + '"]')!.textContent).toBe('`base` + 1'); expect(document.body.querySelector('pre[aria-label="生成列只读SQL测试端口"]')!.getAttribute('data-read-only')).toBe('true');
  expect(button(text.apply).disabled).toBe(true); await check(text.ackImplicit); await check(text.ackWindow); expect(button(text.apply).disabled).toBe(true); await check(text.ackGenerated);
  const applyButton = button(text.apply); await act(async () => { applyButton.dispatchEvent(new MemoryEvent('click')); applyButton.dispatchEvent(new MemoryEvent('click')); }); expect(f.apply).toHaveBeenCalledOnce(); expect(f.services.get).toHaveBeenCalledOnce();
});

it('切换模式保留普通DEFAULT、ON UPDATE与位置，也保留生成表达式但投递时不混入普通属性', async () => {
  const f = await mount(); await click(text.add); await input(text.name, 'computed'); await select(text.family, 'temporal'); await select(text.default, 'null'); await check(text.modify + ' ' + text.onUpdate); await select(text.onUpdate, 'expression'); await select(text.position, 'first');
  await select(text.fieldKind, 'generated'); await input(text.generatedExpression, '`price` * 2.0', 'textarea'); await select(text.generatedStorage, 'STORED'); await select(text.fieldKind, 'ordinary');
  expect(field(text.default).value).toBe('null'); expect(field(text.onUpdate).value).toBe('expression'); expect(field(text.position).value).toBe('first'); expect(field(text.family).value).toBe('temporal');
  await select(text.fieldKind, 'generated'); expect(field(text.generatedExpression, 'textarea').value).toBe('`price` * 2.0'); expect(field(text.generatedStorage).value).toBe('STORED'); await click(text.rowSave); await click(text.preview); expect(f.preview.mock.calls[0][0].patches[0]).toMatchObject({ type: { kind: 'integer' }, nullable: true, default: { kind: 'none' }, position: { kind: 'last' } }); expect(Object.hasOwn(f.preview.mock.calls[0][0].patches[0], 'onUpdate')).toBe(false);
});

it('候选来自明确目录授权且展示实际名字；选择含反引号名字时只生成表达式标识符', async () => {
  await mount(); await generated(''); const sources = field(text.generatedSources); expect(sources.textContent).toContain('odd`name'); expect(sources.textContent).not.toContain('内部引用'); expect(sources.textContent).not.toContain('old_generated'); expect(sources.textContent).not.toContain('updated_at'); await select(text.generatedSources, 'odd`name'); expect(field(text.generatedExpression, 'textarea').value).toBe('`odd``name`');
});

it.each(['`id` + 1', '`old_generated` + 1', '`missing` + 1', '`computed` + 1', 'RAND()', '`base` / 2', '`base`; DROP TABLE t', '`base` /*注释*/ + 1', '(', '1e3'])('非法或未经授权表达式%s留在本地，不投递预览或apply', async expression => {
  const f = await mount(); await generated(expression); await click(text.rowSave); expect(field(text.generatedExpression, 'textarea').value).toBe(expression); expect(f.preview).not.toHaveBeenCalled(); expect(f.apply).not.toHaveBeenCalled(); expect(button(text.preview).disabled).toBe(true);
});

it.each([{ access: false }, { omitAccess: true }, { version: '8.4.12' }])('缺失能力/目录拒绝/未知版本不开放生成模式：%j', async options => {
  const f = await mount(options); await click(text.add); const mode = field(text.fieldKind); expect(mode.querySelectorAll('option').find(node => node.value === 'generated')!.disabled).toBe(true); await select(text.fieldKind, 'generated'); expect(mode.value).toBe('ordinary'); expect(document.body.querySelector('textarea[aria-label="' + text.generatedExpression + '"]')).toBeNull(); expect(f.preview).not.toHaveBeenCalled();
});

it('无可引用字段时允许纯十进制常量，不把未授权类型推成候选', async () => {
  const f = await mount({ noSources: true }); await generated('-(2.0 + 1) * 3'); expect(field(text.generatedSources).disabled).toBe(true); expect(document.body.textContent).toContain(text.generatedNoSources); await click(text.rowSave); await click(text.preview); expect(f.preview).toHaveBeenCalledOnce();
});

it('普通草稿保留且拒绝生成列混批；撤销普通草稿后才能单独预览', async () => {
  const f = await mount(); await click(text.add); await input(text.name, 'ordinary_added'); await click(text.rowSave); await generated(); await click(text.rowSave); expect(f.preview).not.toHaveBeenCalled(); expect(document.body.textContent).toContain('ordinary_added'); expect(field(text.generatedExpression, 'textarea').value).toBe('`base` + 1'); await click(text.back); await click(text.undo); await generated(); await click(text.rowSave); await click(text.preview); expect(f.preview.mock.calls[0][0].patches).toHaveLength(1);
});

it('已有生成字段仍只读，不提供模式切换或生成表达式编辑', async () => {
  const f = await mount(); await click('old_generated · int'); expect(document.body.querySelector('select[aria-label="' + text.fieldKind + '"]')).toBeNull(); expect(document.body.querySelector('textarea[aria-label="' + text.generatedExpression + '"]')).toBeNull(); expect(document.body.textContent).toContain('生成列首批只读'); await click(text.rowSave); expect(f.preview).not.toHaveBeenCalled(); expect(button(text.preview).disabled).toBe(true);
});

it('返回草稿释放原令牌、清空三项确认；缺少生成风险回执时拒绝计划并释放令牌', async () => {
  const f = await mount(); await generated(); await click(text.rowSave); await click(text.preview); await check(text.ackGenerated); await click(text.back); expect(f.release).toHaveBeenCalledWith({ previewToken: 'preview-generated' }); await click(text.preview); expect(button(text.apply).disabled).toBe(true); expect(f.apply).not.toHaveBeenCalled();
  await act(async () => root!.unmount()); root = undefined; const rejected = await mount({ missingAck: true }); await generated(); await click(text.rowSave); await click(text.preview); expect(rejected.release).toHaveBeenCalledWith({ previewToken: 'preview-generated' }); expect(rejected.apply).not.toHaveBeenCalled(); expect(document.body.textContent).toContain(text.generatedStale);
});

it('连接修订ABA与目录授权变化使生成草稿永久失效，不恢复旧回调', async () => {
  const f = await mount(); await generated(); await f.revision(2); await f.revision(1); await click(text.rowSave); expect(f.preview).not.toHaveBeenCalled(); expect(document.body.textContent).toContain(text.generatedStale);
  await act(async () => root!.unmount()); root = undefined; const changed = await mount(); await generated(); changed.snapshot.columns[0].generatedReference = false; await click(text.rowSave); changed.snapshot.columns[0].generatedReference = true; await click(text.rowSave); expect(changed.preview).not.toHaveBeenCalled(); expect(document.body.textContent).toContain(text.generatedStale);
});

it('预览等待期间取消和关闭不能放行原Promise；迟到令牌只精确释放，不复活可执行计划', async () => {
  let resolve!: (value: TableColumnPreviewOutput) => void; const pending = new Promise<TableColumnPreviewOutput>(value => { resolve = value; }); const f = await mount({ preview: () => pending }); await generated(); await click(text.rowSave);
  await act(async () => { button(text.preview).dispatchEvent(new MemoryEvent('click')); }); expect(button(text.close).disabled).toBe(true); await click(text.cancel); expect(f.cancel).toHaveBeenCalledOnce(); expect(button(text.close).disabled).toBe(true); expect(f.close).not.toHaveBeenCalled(); await act(async () => resolve(f.receipt)); expect(f.release).toHaveBeenCalledWith({ previewToken: 'preview-generated' }); expect(f.apply).not.toHaveBeenCalled(); expect(document.body.querySelector('pre[aria-label="生成列只读SQL测试端口"]')).toBeNull(); await click(text.close); expect(f.close).toHaveBeenCalledOnce();
});

it('失败apply不自动重试，原Promise完成之前维持busy及关闭锁', async () => {
  let reject!: (reason: Error) => void; const pending = new Promise<never>((_, value) => { reject = value; }); const f = await mount({ apply: () => pending }); await generated(); await click(text.rowSave); await click(text.preview); await check(text.ackImplicit); await check(text.ackWindow); await check(text.ackGenerated); await act(async () => { button(text.apply).dispatchEvent(new MemoryEvent('click')); }); expect(button(text.close).disabled).toBe(true); expect(f.apply).toHaveBeenCalledOnce(); await act(async () => reject(new Error('合成最终结果未知'))); expect(f.apply).toHaveBeenCalledOnce(); expect(button(text.apply).disabled).toBe(true); expect(document.body.textContent).toContain(text.unknown);
});
