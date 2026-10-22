import { act } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ColumnPatch, TableColumnApplyOutput, TableColumnGetOutput, TableColumnPreviewOutput, TableColumnView } from '../../src/shared/tableColumnPatches';
import { columnAcknowledgementLabel, makeColumnAlter, validateColumnDrafts } from '../../src/renderer/columnPatches';
import { ColumnEncodingIntent, ColumnEncodingPreview, ColumnEncodingSource, columnEncodingRequiredAcknowledgements, makeColumnEncodingAlter } from '../../src/renderer/columnEncoding';
import { columnEncodingZh as text } from '../../src/renderer/locales/columnEncoding.zh-CN';
import { columnPatchZh as common } from '../../src/renderer/locales/columnPatches.zh-CN';
import type { ColumnPatchServices } from '../../src/renderer/components/ColumnPatchDialog';
import { memoryDocument, MemoryEvent, type MemoryNode } from '../fixtures/memory-dom';

// 只替换Monaco显示端口；真实React组件、选择控件、草稿、ACK、租约与异步生命周期保持生产实现。
vi.mock('../../src/renderer/components/SqlEditor', () => ({ SqlEditor: ({ value, readOnly }: { value: string; readOnly: boolean }) => <pre aria-label="只读SQL测试端口" data-read-only={String(readOnly)}>{value}</pre> }));
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let Dialog: typeof import('../../src/renderer/components/ColumnPatchDialog')['ColumnPatchDialog'];
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
beforeAll(async () => {
  document = memoryDocument(); (document as any).oninput = null; const create = document.createElement.bind(document);
  document.createElement = name => {
    const node = create(name), set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node); if (name === 'input') node.type = 'text';
    // 仅补HTML属性反射和受控select端口；不模拟浏览器布局、系统输入或数据库。
    node.setAttribute = (key, value) => { set(key, value); if (key === 'disabled') node.disabled = true; if (key === 'type') node.type = value; if (key === 'value' && name === 'option') node.value = value; };
    node.removeAttribute = key => { remove(key); if (key === 'disabled') node.disabled = false; };
    if (name === 'select') { Object.defineProperty(node, 'options', { get: () => node.querySelectorAll('option') }); Object.defineProperty(node, 'value', { get: () => node.querySelectorAll('option').find(option => (option as any).selected)?.value ?? '', set: value => { for (const option of node.querySelectorAll('option')) (option as any).selected = option.value === value; } }); }
    return node;
  };
  Object.assign(window, { setTimeout: globalThis.setTimeout.bind(globalThis), clearTimeout: globalThis.clearTimeout.bind(globalThis) });
  ({ createRoot } = await import('react-dom/client')); ({ ColumnPatchDialog: Dialog } = await import('../../src/renderer/components/ColumnPatchDialog'));
});
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined; } document.body.textContent = ''; vi.restoreAllMocks(); });
afterAll(() => { for (const [key, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });

const original = { charset: 'latin1', collation: 'latin1_bin' }, destination = { charset: 'utf8mb4', collation: 'utf8mb4_bin' }, required = [...columnEncodingRequiredAcknowledgements];
/** 投影来自测试服务明确授权；类型、索引资格和版本由engine证明，renderer不推测。 */
function snapshot(id = 'encoding-snapshot'): TableColumnGetOutput {
  const access = () => Object.fromEntries(['name', 'type', 'nullable', 'default', 'comment', 'position', 'onUpdate'].map(key => [key, { editable: true }])) as TableColumnView['access'];
  return { target: { connectionId: 'RAM编码', database: 'db', table: 'subject' }, snapshotId: id, ddlHash: '准确原定义摘要', expiresAt: new Date(Date.now() + 300000).toISOString(), warnings: [], capabilities: { dialect: 'mysql', serverVersion: '8.4.11', maxDecimalScale: 30 }, encodingCatalog: [{ ...original }, { charset: 'latin1', collation: 'latin1_swedish_ci' }, { ...destination }, { charset: 'utf8mb4', collation: 'utf8mb4_unicode_ci' }], columns: [
    { columnRef: 'v-ref', name: 'v', ordinal: 0, typeSql: 'VARCHAR(24)', editableType: { kind: 'string', type: 'VARCHAR', length: 24 }, nullable: false, default: { kind: 'literal', valueType: 'text', value: 'café' }, onUpdate: null, comment: '保留原注释', rawDefinition: "`v` VARCHAR(24) CHARACTER SET latin1 COLLATE latin1_bin NOT NULL DEFAULT 'café'", access: access(), encoding: { current: { ...original }, access: { editable: true } } },
    { columnRef: 'other-ref', name: 'other', ordinal: 1, typeSql: 'INT', nullable: false, default: { kind: 'none' }, onUpdate: null, comment: '', rawDefinition: '`other` INT NOT NULL', access: access() },
  ] };
}
/** 本地服务仅观察调用；没有数据库、IPC补写或自动SQL执行。 */
async function mount(initial = snapshot(), acknowledgements = required, initialRead?: Promise<TableColumnGetOutput>) {
  let next = initial, version = 1, sequence = 0;
  const get = vi.fn(async (_input: Parameters<ColumnPatchServices['get']>[0]) => next); if (initialRead) get.mockImplementationOnce(() => initialRead);
  const preview = vi.fn(async (_input: Parameters<ColumnPatchServices['preview']>[0]): Promise<TableColumnPreviewOutput> => ({ target: next.target, ddlHash: next.ddlHash, previewToken: 'encoding-plan-' + (++sequence), expiresAt: next.expiresAt, sql: '服务器固定转换SQL；仅显示不执行', changes: [], warnings: ['转换可能复制重建表'], requiredAcknowledgements: [...acknowledgements], concurrencyPolicy: 'recheck-before-ddl' }));
  const apply = vi.fn(async (_input: Parameters<ColumnPatchServices['apply']>[0]): Promise<TableColumnApplyOutput> => ({ ddlSubmitted: true, ddlCompleted: true, definitionVerified: true, warnings: [] })), release = vi.fn(async (_input: Parameters<ColumnPatchServices['release']>[0]) => {}), cancel = vi.fn(async (_input: { taskId: string }) => {});
  const callbacks = { onClose: vi.fn(), onCleanupError: vi.fn(), onDirtyChange: vi.fn(), onApplied: vi.fn(), beforeApply: vi.fn(), onExecutionUncertain: vi.fn() }, services: ColumnPatchServices = { get, preview, apply, release, cancel }, confirm = vi.fn(() => true); (window as any).confirm = confirm;
  const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as any);
  const render = () => root!.render(<Dialog target={initial.target} targetVersion={version} services={services} {...callbacks}/>); await act(async () => render());
  return { initial, get, preview, apply, release, cancel, callbacks, confirm, next(value: TableColumnGetOutput) { next = value; }, async version(value: number) { version = value; await act(async () => render()); } };
}
/** 当前中文DOM为操作入口；旧回调只用于验证同步身份门，不注入组件state。 */
function button(label: string) { const node = document.querySelectorAll('button').find(node => node.textContent === label); expect(node, label).toBeDefined(); return node!; }
async function click(label: string) { const node = button(label); expect(node.disabled, label).toBe(false); await act(async () => node.dispatchEvent(new MemoryEvent('click'))); }
function select(label: string) { const node = document.querySelector(`select[aria-label="${label}"]`); expect(node, label).not.toBeNull(); return node!; }
async function choose(label: string, value: string) { const node = select(label); expect(node.disabled).toBe(false); await act(async () => { node.value = value; node.dispatchEvent(new MemoryEvent('change')); }); }
function callback(node: MemoryNode, event = 'onClick'): Function { const key = Object.keys(node).find(key => key.startsWith('__reactProps$')); if (!key) throw Error('缺少React事件'); return (node as any)[key][event]; }
async function edit() { await click('v · VARCHAR(24)'); }
async function draft() { await edit(); await choose(text.charset, destination.charset); await choose(text.collation, destination.collation); await click(common.rowSave); }
function acknowledgement(label: string) { const node = document.querySelectorAll('input').find(node => node.type === 'checkbox' && node.parentNode?.textContent === label); expect(node, label).toBeDefined(); return node!; }
async function acknowledge(label: string, checked = true) { const node = acknowledgement(label); await act(async () => { node.checked = checked; node.dispatchEvent(new MemoryEvent('click')); }); }
async function allAcks() { for (const label of [common.ackImplicit, common.ackWindow, text.acknowledgement]) await acknowledge(label); }
/** deferred控制迟到结果及取消ACK，避免sleep或写入重试。 */
function gate<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

describe('跨字符集纯草稿和目录授权', () => {
  it('普通七属性只读不影响独立授权，原值恢复无patch，255字符真实排序规则名保留', () => {
    const source = snapshot(), column = source.columns[0]; for (const item of Object.values(column.access)) item.editable = false;
    const long = { charset: 'utf8mb4', collation: 'u'.repeat(255) }; source.encodingCatalog!.push(long);
    expect(makeColumnEncodingAlter(column, original, source.encodingCatalog)).toBeNull(); expect(makeColumnAlter(column, { encoding: long }, undefined, source.encodingCatalog)).toMatchObject({ changes: { encoding: long } });
    const patch = makeColumnEncodingAlter(column, destination, source.encodingCatalog)!; expect(validateColumnDrafts(source.columns, [patch], 30, undefined, source)).toEqual([patch]); expect(Object.keys(column.access)).not.toContain('encoding'); expect(columnAcknowledgementLabel('column-encoding-copy')).toBe(text.acknowledgement);
  });
  it('缺投影、readonly、旧collation目录、错误配对、重复目录及同charset修改均不授权', () => {
    const source = snapshot(), column = source.columns[0]; delete column.encoding; expect(() => makeColumnEncodingAlter(column, destination, source.encodingCatalog)).toThrow(text.readonly);
    column.encoding = { current: original, access: { editable: false, reason: '外键需要配对修改' } }; expect(() => makeColumnEncodingAlter(column, destination, source.encodingCatalog)).toThrow('外键需要配对修改'); column.encoding.access.editable = true;
    expect(() => makeColumnEncodingAlter(column, destination, undefined)).toThrow(text.catalog); expect(() => makeColumnEncodingAlter(column, { charset: 'latin1', collation: 'utf8mb4_bin' }, source.encodingCatalog)).toThrow(text.invalid); expect(() => makeColumnEncodingAlter(column, { charset: 'latin1', collation: 'latin1_swedish_ci' }, source.encodingCatalog)).toThrow(text.sameCharset);
    source.encodingCatalog!.push({ ...original }); expect(() => new ColumnEncodingSource(source)).toThrow(text.catalog);
  });
  it('显式undefined、其它属性、多列、删除和新增不能混批；同值不是合法预览', () => {
    const source = snapshot(), column = source.columns[0], patch = makeColumnEncodingAlter(column, destination, source.encodingCatalog)!;
    expect(() => makeColumnAlter(column, { encoding: undefined }, undefined, source.encodingCatalog)).toThrow();
    for (const extra of [{ comment: '改注释' }, { collation: original }, { autoIncrement: true }, { generation: { expression: '`other` + 1' } }, { position: { kind: 'first' as const } }]) expect(() => makeColumnAlter(column, { encoding: destination, ...extra }, undefined, source.encodingCatalog)).toThrow(text.mixed);
    for (const extra of [{ kind: 'drop', columnRef: 'other-ref' }, { kind: 'alter', columnRef: 'other-ref', changes: { comment: '原草稿' } }] as ColumnPatch[]) expect(() => validateColumnDrafts(source.columns, [patch, extra], 30, undefined, source)).toThrow();
    expect(() => validateColumnDrafts(source.columns, [{ kind: 'alter', columnRef: column.columnRef, changes: { encoding: original } }], 30, undefined, source)).toThrow(common.noChange);
  });
  it.each(['catalog-array', 'catalog-pair', 'catalog-value', 'projection', 'current', 'access', 'columns', 'raw', 'hash', 'target', 'expiry'] as const)('%s漂移被观察后不可ABA恢复，显式重读才创建新意图', kind => {
    const source = snapshot(), column = source.columns[0], intent = new ColumnEncodingIntent(source, column), saved = { catalog: source.encodingCatalog!, pair: source.encodingCatalog![0], projection: column.encoding!, current: column.encoding!.current, access: column.encoding!.access, columns: source.columns, raw: column.rawDefinition, hash: source.ddlHash, table: source.target.table, expiry: source.expiresAt };
    expect(intent.current(source)).toBe(true);
    if (kind === 'catalog-array') source.encodingCatalog = source.encodingCatalog!.slice(); if (kind === 'catalog-pair') source.encodingCatalog![0] = { ...saved.pair }; if (kind === 'catalog-value') saved.pair.collation = '漂移'; if (kind === 'projection') column.encoding = { ...column.encoding! }; if (kind === 'current') column.encoding!.current = { ...column.encoding!.current }; if (kind === 'access') column.encoding!.access = { ...column.encoding!.access }; if (kind === 'columns') source.columns = source.columns.slice(); if (kind === 'raw') column.rawDefinition += ' OTHER'; if (kind === 'hash') source.ddlHash = '其它摘要'; if (kind === 'target') source.target.table = '其它表'; if (kind === 'expiry') source.expiresAt = new Date(Date.now() - 1).toISOString();
    expect(intent.current(source)).toBe(false); source.encodingCatalog = saved.catalog; source.encodingCatalog[0] = saved.pair; saved.pair.collation = original.collation; column.encoding = saved.projection; column.encoding.current = saved.current; column.encoding.access = saved.access; source.columns = saved.columns; column.rawDefinition = saved.raw; source.ddlHash = saved.hash; source.target.table = saved.table; source.expiresAt = saved.expiry;
    expect(intent.current(source)).toBe(false); expect(new ColumnEncodingIntent(source, column).current(source)).toBe(true);
  });
  it('预览缺风险、回执篡改或补丁数组替换均永久拒绝，消费仅准本次内部复核', () => {
    const source = snapshot(), intent = new ColumnEncodingIntent(source, source.columns[0]), patches = [makeColumnEncodingAlter(source.columns[0], destination, source.encodingCatalog)!];
    const preview: TableColumnPreviewOutput = { target: source.target, ddlHash: source.ddlHash, previewToken: 'p', expiresAt: source.expiresAt, sql: '仅服务器计划', changes: [], warnings: [], requiredAcknowledgements: required, concurrencyPolicy: 'recheck-before-ddl' };
    const incomplete = { ...preview, requiredAcknowledgements: required.slice(0, 2) };
    expect(new ColumnEncodingPreview(intent, patches, incomplete).current(source, patches, incomplete)).toBe(false);
    const owner = new ColumnEncodingPreview(intent, patches, preview); expect(owner.current(source, patches, preview)).toBe(true); owner.consume(); expect(owner.current(source, patches, preview)).toBe(false); expect(owner.current(source, patches, preview, true)).toBe(true); preview.sql += '篡改'; expect(owner.current(source, patches, preview, true)).toBe(false); preview.sql = '仅服务器计划'; expect(owner.current(source, patches, preview, true)).toBe(false);
    const replacement = new ColumnEncodingPreview(intent, patches, preview); expect(replacement.current(source, patches.slice(), preview)).toBe(false); expect(replacement.current(source, patches, preview)).toBe(false);
  });
});

describe('跨字符集真实ColumnPatchDialog RAM闭环', () => {
  it('get明确opt-in，选择charset不猜collation也不查询；完整pair预览及三ACK仅应用一次', async () => {
    const f = await mount(), before = structuredClone(f.initial); expect(f.get).toHaveBeenCalledWith(expect.objectContaining({ includeEncodingFacts: true })); await edit(); expect(select(text.charset).value).toBe('latin1'); expect(select(text.collation).value).toBe('latin1_bin');
    await choose(text.charset, 'utf8mb4'); expect(select(text.collation).value).toBe(''); expect(f.preview).not.toHaveBeenCalled(); await click(common.rowSave); expect(document.body.textContent).toContain(text.title); expect(f.preview).not.toHaveBeenCalled();
    await choose(text.collation, 'utf8mb4_bin'); await click(common.rowSave); await click(common.preview); expect(f.preview.mock.calls[0][0].patches).toEqual([{ kind: 'alter', columnRef: 'v-ref', changes: { encoding: destination } }]); expect(document.querySelector('pre[aria-label="只读SQL测试端口"]')!.getAttribute('data-read-only')).toBe('true');
    await acknowledge(common.ackImplicit); await acknowledge(common.ackWindow); expect(button(common.apply).disabled).toBe(true); await acknowledge(text.acknowledgement); const execute = callback(button(common.apply)); await act(async () => { execute(); execute(); }); await act(async () => execute()); expect(f.apply).toHaveBeenCalledOnce(); expect(f.apply.mock.calls[0][0]).toMatchObject({ previewToken: 'encoding-plan-1', acknowledgements: required }); expect(f.initial).toEqual(before); expect(f.callbacks.onApplied).toHaveBeenCalledOnce();
  });
  it('选回准确原pair或恢复按钮清除差异，已暂存encoding也能明确恢复', async () => {
    const f = await mount(); await edit(); await choose(text.charset, 'utf8mb4'); await choose(text.collation, 'utf8mb4_bin'); await click(text.restore); expect(select(text.charset).value).toBe('latin1'); expect(select(text.collation).value).toBe('latin1_bin'); await click(common.rowSave); expect(button(common.preview).disabled).toBe(true);
    await draft(); await edit(); await choose(text.charset, 'latin1'); await click(common.rowSave); expect(button(common.preview).disabled).toBe(true); expect(f.callbacks.onDirtyChange).toHaveBeenLastCalledWith(false); expect(f.preview).not.toHaveBeenCalled();
  });
  it.each([['mysql', '5.7.44'], ['mysql', '8.0.46'], ['mysql', '8.4.11'], ['mariadb', '10.11.19'], ['mariadb', '11.4.13'], ['mysql', '服务器另行证明版本']] as const)('注入%s/%s投影明确授权时renderer不设置版本门（非实库证明）', async (dialect, serverVersion) => {
    const source = snapshot(); source.capabilities = { dialect, serverVersion, maxDecimalScale: dialect === 'mariadb' ? 38 : 30 }; const f = await mount(source); await draft(); await click(common.preview); expect(f.preview).toHaveBeenCalledOnce();
  });
  it.each(['missing', 'readonly', 'catalog'] as const)('%s不靠普通字段权限或旧collationCatalog猜授权', async kind => {
    const source = snapshot(); if (kind === 'missing') delete source.columns[0].encoding; if (kind === 'readonly') source.columns[0].encoding!.access = { editable: false, reason: '外键须多目标配对' }; if (kind === 'catalog') { source.collationCatalog = source.encodingCatalog; delete source.encodingCatalog; }
    const f = await mount(source); await edit(); expect(select(text.charset).disabled).toBe(true); await act(async () => callback(select(text.charset), 'onChange')({ target: { value: 'utf8mb4' } })); expect(f.preview).not.toHaveBeenCalled(); expect(f.apply).not.toHaveBeenCalled(); if (kind === 'readonly') expect(document.body.textContent).toContain('外键须多目标配对');
  });
  it('同charset其它排序规则不混入新入口，伪造pair及已消费事件不改变草稿', async () => {
    const f = await mount(); await edit(); expect(select(text.collation).querySelectorAll('option').map(node => node.value)).toEqual(['', 'latin1_bin']); expect(document.body.textContent).toContain(text.sameCharset);
    await act(async () => callback(select(text.collation), 'onChange')({ target: { value: 'latin1_swedish_ci' } })); expect(select(text.collation).value).toBe('latin1_bin');
    await act(async () => callback(select(text.charset), 'onChange')({ defaultPrevented: true, target: { value: 'utf8mb4' } })); expect(select(text.charset).value).toBe('latin1'); await click(common.rowSave); expect(f.preview).not.toHaveBeenCalled(); expect(button(common.preview).disabled).toBe(true);
  });
  it('已有普通草稿保持，旧普通checkbox不能混入刚选择的编码；新增删除也不自动清稿', async () => {
    const f = await mount(); await edit(); const node = document.querySelectorAll('input').find(node => node.parentNode?.textContent === common.modify + ' ' + common.comment)!, old = callback(node, 'onChange'); await choose(text.charset, 'utf8mb4'); await choose(text.collation, 'utf8mb4_bin'); await act(async () => old({ target: { checked: true } })); await click(common.rowSave); await click(common.add); await click(common.drop); expect(f.confirm).not.toHaveBeenCalled(); await click(common.preview); expect(f.preview.mock.calls[0][0].patches).toEqual([{ kind: 'alter', columnRef: 'v-ref', changes: { encoding: destination } }]);
    await click(common.back); await click(common.undo); await edit(); const current = document.querySelectorAll('input').find(node => node.parentNode?.textContent === common.modify + ' ' + common.comment)!; await act(async () => { current.checked = true; current.dispatchEvent(new MemoryEvent('click')); }); await act(async () => callback(document.querySelector(`textarea[aria-label="${common.comment}"]`)!, 'onChange')({ target: { value: '保留普通差异' } })); await click(common.rowSave); await edit(); expect(select(text.charset).disabled).toBe(true); await act(async () => callback(select(text.charset), 'onChange')({ target: { value: 'utf8mb4' } })); await click(common.back); await click(common.preview); expect(f.preview.mock.calls.at(-1)![0].patches).toEqual([{ kind: 'alter', columnRef: 'v-ref', changes: { comment: '保留普通差异' } }]);
  });
  it('旧charset/pair/保存/返回事件不能覆盖后继编辑器，目录观察到变化后回退也无授权', async () => {
    const f = await mount(); await edit(); const oldCharset = callback(select(text.charset), 'onChange'), oldPair = callback(select(text.collation), 'onChange'), oldBack = callback(button(common.back)); await choose(text.charset, 'utf8mb4'); await choose(text.collation, 'utf8mb4_bin'); const oldSave = callback(button(common.rowSave)); await click(common.rowSave); await edit(); await click(text.restore);
    await act(async () => { oldCharset({ target: { value: 'utf8mb4' } }); oldPair({ target: { value: 'utf8mb4_bin' } }); oldSave(); oldBack(); }); expect(select(text.charset).value).toBe('latin1'); await click(common.rowSave); expect(button(common.preview).disabled).toBe(true);
    const column = f.initial.columns[0], originalProjection = column.encoding!; column.encoding = { ...originalProjection }; await edit(); column.encoding = originalProjection; await edit(); expect(document.querySelector(`select[aria-label="${text.charset}"]`)).toBeNull(); expect(f.preview).not.toHaveBeenCalled();
  });
  it('连接版本ABA和旧快照行回调不恢复授权；只有重新读取可用新目录', async () => {
    const f = await mount(), oldEdit = callback(button('v · VARCHAR(24)')); await draft(); const oldPreview = callback(button(common.preview)); f.next(snapshot('new-source')); await click(common.read); await act(async () => { oldEdit(); oldPreview(); }); expect(f.preview).not.toHaveBeenCalled(); expect(document.querySelector(`select[aria-label="${text.charset}"]`)).toBeNull(); await edit(); const old = callback(select(text.charset), 'onChange'); await f.version(2); await f.version(1); await act(async () => old({ target: { value: 'utf8mb4' } })); expect(select(text.charset).disabled).toBe(true); expect(f.apply).not.toHaveBeenCalled();
  });
  it.each([{ risks: required.slice(0, 2) }, { risks: [...required, required[2]] }])('缺失或重复转换风险回执释放迟到token，不能显示可执行预览 %#', async ({ risks }) => {
    const f = await mount(snapshot(), risks); await draft(); await click(common.preview); expect(f.release).toHaveBeenCalledWith({ previewToken: 'encoding-plan-1' }); expect(f.apply).not.toHaveBeenCalled(); expect(document.body.textContent).toContain(text.stale);
  });
  it('preview等待时目录漂移，迟到回执释放，不复活原授权', async () => {
    const f = await mount(), waiting = gate<TableColumnPreviewOutput>(); f.preview.mockImplementationOnce(() => waiting.promise); await draft(); await click(common.preview); f.initial.encodingCatalog![0] = { ...original }; await act(async () => waiting.resolve({ target: f.initial.target, ddlHash: f.initial.ddlHash, previewToken: 'late-encoding', expiresAt: f.initial.expiresAt, sql: '迟到原计划', changes: [], warnings: [], requiredAcknowledgements: required, concurrencyPolicy: 'recheck-before-ddl' })); expect(f.release).toHaveBeenCalledWith({ previewToken: 'late-encoding' }); expect(f.apply).not.toHaveBeenCalled();
  });
  it('旧预览返回不能释放后继token，旧字段行不能在当前预览背后重新打开输入', async () => {
    const f = await mount(), oldEdit = callback(button('v · VARCHAR(24)')); await draft(); await click(common.preview); const oldBack = callback(button(common.back)); await click(common.back); await click(common.preview); const before = f.release.mock.calls.length; await act(async () => { oldBack(); oldEdit(); }); expect(f.release.mock.calls).toHaveLength(before); expect(document.querySelector(`select[aria-label="${text.charset}"]`)).toBeNull(); await allAcks(); await click(common.apply); expect(f.apply).toHaveBeenCalledWith(expect.objectContaining({ previewToken: 'encoding-plan-2' }));
  });
  it('同preview取消ACK及同值ABA不复活旧apply或旧checkbox，最新确认仍可提交', async () => {
    const f = await mount(); await draft(); await click(common.preview); await allAcks(); const oldApply = callback(button(common.apply)), oldRisk = callback(acknowledgement(text.acknowledgement), 'onChange'); await acknowledge(common.ackImplicit, false); await act(async () => { oldApply(); oldRisk({ target: { checked: true } }); }); expect(acknowledgement(common.ackImplicit).checked).toBe(false); expect(f.apply).not.toHaveBeenCalled(); await acknowledge(common.ackImplicit); await act(async () => oldApply()); expect(f.apply).not.toHaveBeenCalled(); await click(common.apply); expect(f.apply).toHaveBeenCalledOnce();
  });
  it('beforeApply同步修改来源或取消时不发送，已消费旧事件不能在恢复后重放', async () => {
    const f = await mount(); await draft(); await click(common.preview); await allAcks(); const old = callback(button(common.apply)), pair = f.initial.encodingCatalog![0]; f.callbacks.beforeApply.mockImplementationOnce(() => { f.initial.encodingCatalog![0] = { ...pair }; }); await act(async () => old()); f.initial.encodingCatalog![0] = pair; await act(async () => old()); expect(f.apply).not.toHaveBeenCalled(); expect(f.callbacks.onDirtyChange).toHaveBeenLastCalledWith(true); expect(document.body.textContent).toContain(common.notSent);
  });
  it('beforeApply同步重入只投递一次，父数据草稿取消保留草稿且不误报DDL未知', async () => {
    const f = await mount(); await draft(); await click(common.preview); await allAcks(); const old = callback(button(common.apply)); f.callbacks.beforeApply.mockImplementationOnce(() => { old(); throw Error('父数据草稿取消'); }); await act(async () => old()); expect(f.apply).not.toHaveBeenCalled(); expect(f.callbacks.beforeApply).toHaveBeenCalledOnce(); expect(f.callbacks.onExecutionUncertain).not.toHaveBeenCalled(); expect(f.callbacks.onDirtyChange).toHaveBeenLastCalledWith(true); expect(document.body.textContent).toContain(common.notSent);
  });
  it('beforeApply同步重复执行当前事件只经过一次父守卫和一次apply', async () => {
    const f = await mount(); await draft(); await click(common.preview); await allAcks(); const execute = callback(button(common.apply)); f.callbacks.beforeApply.mockImplementationOnce(() => { execute(); }); await act(async () => execute()); expect(f.apply).toHaveBeenCalledOnce(); expect(f.callbacks.beforeApply).toHaveBeenCalledOnce(); expect(f.callbacks.onApplied).toHaveBeenCalledOnce();
  });
  it.each(['read', 'close'] as const)('初始旧%s回调确认后继草稿，确认中apply重入不消费预览，取消保持输入', async action => {
    const source = snapshot(), first = gate<TableColumnGetOutput>(), f = await mount(source, required, first.promise), old = callback(button(action === 'read' ? common.read : common.close)); await act(async () => first.resolve(source)); await draft(); await click(common.preview); await allAcks(); const execute = callback(button(common.apply)); f.confirm.mockImplementationOnce(() => { execute(); return false; }); await act(async () => old()); expect(f.confirm).toHaveBeenCalledWith(common.discard); expect(f.apply).not.toHaveBeenCalled(); expect(f.callbacks.beforeApply).not.toHaveBeenCalled(); expect(f.release).not.toHaveBeenCalled(); expect(f.get).toHaveBeenCalledOnce(); expect(f.callbacks.onClose).not.toHaveBeenCalled(); expect(button(common.apply).disabled).toBe(false);
  });
  it('取消ACK后仍等原preview终态，忙碌时旧选择不能改草稿，迟到token释放后才收尾', async () => {
    const f = await mount(), waiting = gate<TableColumnPreviewOutput>(); await edit(); const old = callback(select(text.charset), 'onChange'); await choose(text.charset, 'utf8mb4'); await choose(text.collation, 'utf8mb4_bin'); await click(common.rowSave); f.preview.mockImplementationOnce(() => waiting.promise); await click(common.preview); await click(common.cancel); expect(button(common.close).disabled).toBe(true); await act(async () => old({ target: { value: 'latin1' } })); await act(async () => waiting.resolve({ target: f.initial.target, ddlHash: f.initial.ddlHash, previewToken: 'cancelled-encoding', expiresAt: f.initial.expiresAt, sql: '取消迟到', changes: [], warnings: [], requiredAcknowledgements: required, concurrencyPolicy: 'recheck-before-ddl' })); expect(f.release).toHaveBeenCalledWith({ previewToken: 'cancelled-encoding' }); expect(button(common.close).disabled).toBe(false); expect(f.apply).not.toHaveBeenCalled(); expect(f.callbacks.onDirtyChange).toHaveBeenLastCalledWith(true);
  });
  it('DDL已完成但后核失败保留事实，清结构草稿后禁止旧回调重放', async () => {
    const f = await mount(); f.apply.mockResolvedValueOnce({ ddlSubmitted: true, ddlCompleted: true, definitionVerified: false, warnings: ['服务器后核未完成'] }); await draft(); await click(common.preview); await allAcks(); const old = callback(button(common.apply)); await click(common.apply); await act(async () => old()); expect(f.apply).toHaveBeenCalledOnce(); expect(f.callbacks.onApplied).toHaveBeenCalledWith(expect.objectContaining({ definitionVerified: false })); expect(f.callbacks.onDirtyChange).toHaveBeenLastCalledWith(false); expect(document.body.textContent).toContain(common.verificationFailed);
  });
});
