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

/** 原服务投影只在RAM显式声明；组件、共享校验和DOM事件真实执行，不冒充实库能力发现。 */
async function mount(options: { storage?: 'VIRTUAL' | 'STORED'; access?: boolean; omitGeneration?: boolean; originalExpression?: string; missingAck?: boolean; preview?: () => Promise<TableColumnPreviewOutput>; apply?: ColumnPatchServices['apply'] } = {}) {
  const target = { connectionId: 'synthetic-expression', database: 'db', table: 't' }, storage = options.storage ?? 'VIRTUAL', expression = options.originalExpression ?? '(`base` * `price`)';
  const model = parseTableColumnDefinition('CREATE TABLE t (`base` int NULL,`price` decimal(20,6) NULL,`odd``name` int NULL,`computed` decimal(30,6) GENERATED ALWAYS AS (' + expression + ') ' + storage + " COMMENT '原备注',`later` int NULL,`other_generated` int GENERATED ALWAYS AS (`base`+1) VIRTUAL,`ordinary` varchar(30) NULL) ENGINE=InnoDB", { dialect: 'mysql', mode: { ansiQuotes: false, noBackslashEscapes: false } });
  const snapshot: TableColumnGetOutput = { target, snapshotId: 'snapshot-expression', ddlHash: '原表达式定义摘要', expiresAt: new Date(Date.now() + 300000).toISOString(), columns: model.columns.map(column => ({ columnRef: '内部引用-' + column.ordinal, name: column.name, ordinal: column.ordinal, typeSql: column.type.raw, nullable: column.nullable, default: column.default, comment: column.comment, rawDefinition: column.raw, access: columnPatchAccess(column, 'mysql', '8.4.11'), generatedReference: ['base', 'price', 'odd`name', 'later'].includes(column.name), ...(column.name === 'computed' && !options.omitGeneration ? { generation: { storage, expression, access: { editable: options.access !== false, ...(options.access === false ? { reason: '合成真实目录禁止修改本列' } : {}) } } } : {}) })), warnings: [], capabilities: { dialect: 'mysql', serverVersion: '8.4.11', maxDecimalScale: 30 }, generatedAccess: { editable: false, reason: '合成新增能力不可用，不替代已有表达式独立能力' } };
  const receipt: TableColumnPreviewOutput = { target, previewToken: 'preview-expression', expiresAt: snapshot.expiresAt, ddlHash: snapshot.ddlHash, sql: '-- 合成边界固定只读预览，真实SQL由引擎专项验证', changes: [], warnings: [], requiredAcknowledgements: ['ddl-implicit-commit', 'external-ddl-window', 'generated-column-computation', ...(options.missingAck ? [] : ['generated-expression-recalculation'])], concurrencyPolicy: 'recheck-before-ddl' };
  const preview = vi.fn<ColumnPatchServices['preview']>(options.preview ?? (async () => receipt)), apply = vi.fn<ColumnPatchServices['apply']>(options.apply ?? (async () => ({ ddlSubmitted: true as const, ddlCompleted: true as const, definitionVerified: true, warnings: [] }))), release = vi.fn(async () => {}), cancel = vi.fn(async () => {}), close = vi.fn(), dirty = vi.fn();
  const services: ColumnPatchServices = { get: vi.fn(async () => snapshot), preview, apply, release, cancel }, noop = () => {};
  const props = { target, targetVersion: 1, services, onClose: close, onCleanupError: noop, onDirtyChange: dirty, onApplied: noop, beforeApply: noop, onExecutionUncertain: noop };
  const container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container as any); await act(async () => root!.render(<ColumnPatchDialog {...props}/>));
  return { snapshot, receipt, preview, apply, release, cancel, close, dirty, services, async revision(value: number) { await act(async () => root!.render(<ColumnPatchDialog {...props} targetVersion={value}/>)); } };
}
/** 所有操作经真实ReactDOM公开控件，不调用组件内部setter，不复刻组件判断。 */
function button(label: string) { const node = document.body.querySelectorAll('button').find(node => node.textContent === label); expect(node, label).toBeDefined(); return node!; }
async function click(label: string) { const node = button(label); expect(node.disabled, label).toBe(false); await act(async () => node.dispatchEvent(new MemoryEvent('click'))); }
function field(label: string, kind = 'textarea') { const node = document.body.querySelectorAll(kind).find(node => node.getAttribute('aria-label') === label || node.parentNode?.textContent === label); expect(node, label).toBeDefined(); return node!; }
function checkbox(label: string) { const node = document.body.querySelectorAll('input').find(node => node.type === 'checkbox' && (node.getAttribute('aria-label') === label || node.parentNode?.textContent === label)); expect(node, label).toBeDefined(); return node!; }
async function check(label: string) { const node = checkbox(label); expect(node.disabled).toBe(false); await act(async () => { node.checked = !node.checked; node.dispatchEvent(new MemoryEvent('click')); }); }
async function input(label: string, value: string, kind = 'textarea') { const node = field(label, kind); expect(node.disabled).toBe(false); await act(async () => { node.value = value; node.dispatchEvent(new MemoryEvent('input')); }); }
/** 打开本例原生成列并明确启用专用修改，只有此后才能写本地草稿。 */
async function edit(expression = '`base` * `price` + 2.000000') { await click('computed · decimal(30,6)'); await check(text.generationModify); await input(text.generationNext, expression); }
async function confirm() { for (const label of [text.ackImplicit, text.ackWindow, text.ackGenerationComputation, text.ackGenerationRecalculation]) await check(label); }

it.each(['VIRTUAL', 'STORED'] as const)('%s已有生成列固定属性展示、旧新表达式预览及四确认后单次apply', async storage => {
  const f = await mount({ storage }); await click('computed · decimal(30,6)'); expect(document.body.textContent).toContain(storage); expect(document.body.textContent).toContain('原备注'); expect(field(text.generationCurrent, 'pre').textContent).toBe('(`base` * `price`)'); expect(field(text.generationNext).disabled).toBe(true); expect(document.body.querySelector('select[aria-label="' + text.fieldKind + '"]')).toBeNull(); expect(document.body.querySelector('input[aria-label="' + text.name + '"]')).toBeNull(); expect(document.body.querySelector('select[aria-label="' + text.position + '"]')).toBeNull();
  expect(document.body.querySelectorAll('input').filter(node => node.type === 'checkbox')).toHaveLength(1); await check(text.generationModify); await input(text.generationNext, '`base` * `price` + 2.000000'); await click(text.rowSave); expect(f.preview).not.toHaveBeenCalled(); expect(f.apply).not.toHaveBeenCalled(); await click(text.preview);
  expect(f.preview.mock.calls[0][0].patches).toEqual([{ kind: 'alter', columnRef: '内部引用-3', changes: { generation: { expression: '`base` * `price` + 2.000000' } } }]); expect(field(text.generationBefore, 'pre').textContent).toBe('(`base` * `price`)'); expect(field(text.generationAfter, 'pre').textContent).toBe('`base` * `price` + 2.000000'); expect(document.body.textContent).toContain(text.generationCopyHint); expect(document.body.textContent).not.toContain(text.ackGenerated); expect(button(text.apply).disabled).toBe(true);
  await check(text.ackImplicit); await check(text.ackWindow); await check(text.ackGenerationComputation); expect(button(text.apply).disabled).toBe(true); await check(text.ackGenerationRecalculation); const applyButton = button(text.apply); await act(async () => { applyButton.dispatchEvent(new MemoryEvent('click')); applyButton.dispatchEvent(new MemoryEvent('click')); }); expect(f.apply).toHaveBeenCalledOnce(); expect(f.services.get).toHaveBeenCalledOnce(); expect(f.apply.mock.calls[0][0].acknowledgements).toHaveLength(4);
});

it.each(['(`base` * `price`)', '( +(`base`) * (+`price`))', ' base * price '])('无实际差异%s清除本地意图，不预览或发送DDL', async expression => {
  const f = await mount(); await edit(expression); await click(text.rowSave); expect(button(text.preview).disabled).toBe(true); expect(f.preview).not.toHaveBeenCalled(); expect(f.apply).not.toHaveBeenCalled(); expect(f.dirty).toHaveBeenLastCalledWith(false);
});

it('十进制尺度不同保留实际意图，取消勾选恢复原值不留补丁', async () => {
  const f = await mount({ originalExpression: '`base` * 1.0' }); await edit('`base` * 1.00'); await click(text.rowSave); expect(button(text.preview).disabled).toBe(false); await click('computed · decimal(30,6)'); expect(field(text.generationNext).value).toBe('`base` * 1.00'); await check(text.generationModify); await click(text.rowSave); expect(button(text.preview).disabled).toBe(true); expect(f.preview).not.toHaveBeenCalled();
});

it('来源仅显示目标前序明确授权普通字段，不含自身/后序/生成链或内部ref，插入真实转义名字', async () => {
  await mount(); await edit(''); const sources = field(text.generatedSources, 'select'); expect(sources.textContent).toContain('odd`name'); for (const excluded of ['computed', 'later', 'other_generated', 'ordinary', '内部引用']) expect(sources.textContent).not.toContain(excluded); await act(async () => { sources.value = 'odd`name'; sources.dispatchEvent(new MemoryEvent('change')); }); expect(field(text.generationNext).value).toBe('`odd``name`');
});

it.each(['`computed` + 1', '`other_generated` + 1', '`later` + 1', '`missing` + 1', 'NOW()', '`base` / 2', '`base`;DROP TABLE t', '`base` /*注释*/ + 1', '('.repeat(17) + '1' + ')'.repeat(17), '1e3'])('非法/循环/后序/未经授权表达式%s只留本地', async expression => {
  const f = await mount(); await edit(expression); await click(text.rowSave); expect(field(text.generationNext).value).toBe(expression); expect(f.preview).not.toHaveBeenCalled(); expect(f.apply).not.toHaveBeenCalled(); expect(button(text.preview).disabled).toBe(true);
});

it('generation缺省或明确只读不能借普通属性权限伪造表达式修改', async () => {
  const f = await mount({ access: false }); await click('computed · decimal(30,6)'); expect(checkbox(text.generationModify).disabled).toBe(true); expect(field(text.generationNext).disabled).toBe(true); await act(async () => { const node = checkbox(text.generationModify); node.checked = true; node.dispatchEvent(new MemoryEvent('click')); }); await click(text.rowSave); expect(f.preview).not.toHaveBeenCalled(); expect(button(text.preview).disabled).toBe(true);
  await act(async () => root!.unmount()); root = undefined; const missing = await mount({ omitGeneration: true }); await click('computed · decimal(30,6)'); expect(document.body.querySelector('textarea[aria-label="' + text.generationNext + '"]')).toBeNull(); expect(document.body.textContent).toContain('生成列首批只读'); expect(missing.preview).not.toHaveBeenCalled();
});

it('普通列没有专用入口，普通新增草稿不会被启用已有生成表达式时丢弃或混批', async () => {
  const f = await mount(); await click('ordinary · varchar(30)'); expect(document.body.querySelector('textarea[aria-label="' + text.generationNext + '"]')).toBeNull(); await click(text.back); await click(text.add); await input(text.name, 'ordinary_added', 'input'); await click(text.rowSave); await click('computed · decimal(30,6)'); await check(text.generationModify); expect(document.body.textContent).toContain(text.generationMixed); expect(document.body.textContent).toContain('ordinary_added'); expect(field(text.generationNext).disabled).toBe(true); expect(f.preview).not.toHaveBeenCalled();
});

it('另一个普通修改不能与已暂存生成表达式混批，原生成草稿仍保留', async () => {
  const f = await mount(); await edit(); await click(text.rowSave); await click(text.add); await input(text.name, 'ordinary_added', 'input'); await click(text.rowSave); expect(document.body.textContent).toContain('生成表达式必须'); expect(document.body.textContent).toContain('computed'); expect(f.preview).not.toHaveBeenCalled(); expect(button(text.preview).disabled).toBe(true);
});

it('返回编辑释放原计划并重置四项确认；缺少重算确认的回执不成为可执行预览', async () => {
  const f = await mount(); await edit(); await click(text.rowSave); await click(text.preview); await confirm(); await click(text.back); expect(f.release).toHaveBeenCalledWith({ previewToken: 'preview-expression' }); await click(text.preview); expect(button(text.apply).disabled).toBe(true); expect(f.apply).not.toHaveBeenCalled();
  await act(async () => root!.unmount()); root = undefined; const missing = await mount({ missingAck: true }); await edit(); await click(text.rowSave); await click(text.preview); expect(missing.release).toHaveBeenCalledWith({ previewToken: 'preview-expression' }); expect(missing.apply).not.toHaveBeenCalled(); expect(document.body.textContent).toContain(text.generatedStale);
});

it('预览正文/风险列表篡改被观察后永久失效，恢复旧值也不投递apply', async () => {
  const f = await mount(); await edit(); await click(text.rowSave); await click(text.preview); await confirm(); const sql = f.receipt.sql; f.receipt.sql = '-- 被篡改'; await click(text.apply); expect(f.apply).not.toHaveBeenCalled(); f.receipt.sql = sql; await click(text.apply); expect(f.apply).not.toHaveBeenCalled(); expect(document.body.textContent).toContain(text.generatedStale);
});

it('连接ABA或等值对象图替换使已有表达式意图永久失效，不重新借相同投影授权', async () => {
  const f = await mount(); await edit(); await f.revision(2); await f.revision(1); await click(text.rowSave); expect(f.preview).not.toHaveBeenCalled(); expect(document.body.textContent).toContain(text.generationReadonly);
  await act(async () => root!.unmount()); root = undefined; const changed = await mount(); await edit(); const original = changed.snapshot.columns; changed.snapshot.columns = [...original]; await click(text.rowSave); changed.snapshot.columns = original; await click(text.rowSave); expect(changed.preview).not.toHaveBeenCalled(); expect(document.body.textContent).toContain(text.generationReadonly);
});

it('preview取消和迟到回执仍等原Promise并精确释放，不复活计划或提前关闭', async () => {
  let resolve!: (receipt: TableColumnPreviewOutput) => void; const pending = new Promise<TableColumnPreviewOutput>(value => { resolve = value; }); const f = await mount({ preview: () => pending }); await edit(); await click(text.rowSave); await act(async () => { button(text.preview).dispatchEvent(new MemoryEvent('click')); }); await click(text.cancel); expect(button(text.close).disabled).toBe(true); expect(f.close).not.toHaveBeenCalled(); await act(async () => resolve(f.receipt)); expect(f.release).toHaveBeenCalledWith({ previewToken: 'preview-expression' }); expect(document.body.querySelector('pre[aria-label="生成列只读SQL测试端口"]')).toBeNull(); expect(f.apply).not.toHaveBeenCalled(); await click(text.close); expect(f.close).toHaveBeenCalledOnce();
});

it('apply未知不重放，取消等待原Promise结束后才解除关闭锁', async () => {
  let reject!: (reason: Error) => void; const pending = new Promise<never>((_, value) => { reject = value; }); const f = await mount({ apply: () => pending }); await edit(); await click(text.rowSave); await click(text.preview); await confirm(); await act(async () => { button(text.apply).dispatchEvent(new MemoryEvent('click')); }); await click(text.cancel); expect(button(text.close).disabled).toBe(true); expect(f.apply).toHaveBeenCalledOnce(); await act(async () => reject(new Error('合成重算最终结果未知'))); expect(f.apply).toHaveBeenCalledOnce(); expect(button(text.apply).disabled).toBe(true); expect(document.body.textContent).toContain(text.unknown); expect(button(text.close).disabled).toBe(false);
});

