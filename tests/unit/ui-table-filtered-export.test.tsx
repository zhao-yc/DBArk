import { act } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FileChoice, TableInfo, TaskEvent } from '../../src/shared/contracts';
import type { TableFilteredExportOutput } from '../../src/shared/tableFilteredExport';
import type { TableFilteredExportServices } from '../../src/renderer/components/TableFilteredExportDialog';
import { TableFilteredExportIntent } from '../../src/renderer/tableFilteredExportUi';
import { tableFilteredExportZh as text } from '../../src/renderer/locales/tableFilteredExport.zh-CN';
import { csvExportZh as csvText } from '../../src/renderer/locales/csvExport.zh-CN';
import { memoryDocument, MemoryEvent, type MemoryNode } from '../fixtures/memory-dom';
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let Dialog: typeof import('../../src/renderer/components/TableFilteredExportDialog')['TableFilteredExportDialog'];
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
beforeAll(async () => {
  document = memoryDocument(); Object.defineProperty(document, 'oninput', { value: null, configurable: true });
  const create = document.createElement.bind(document);
  /** 只补标准HTML属性端口；组件、React状态、任务Promise与条件核心均使用真实产品实现。 */
  document.createElement = name => {
    const node = create(name), set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node);
    if (name === 'input') node.type = 'text';
    node.setAttribute = (key, value) => { set(key, value); if (key === 'disabled') node.disabled = true; if (key === 'type') node.type = value; };
    node.removeAttribute = key => { remove(key); if (key === 'disabled') node.disabled = false; };
    if (name === 'select') Object.defineProperties(node, {
      options: { configurable: true, get: () => node.querySelectorAll('option') },
      value: { configurable: true, get: () => node.querySelectorAll('option').find(option => Reflect.get(option, 'selected') === true)?.value ?? '', set: (value: string) => { let matched = false; for (const option of node.querySelectorAll('option')) { const selected = !matched && option.value === String(value); Reflect.set(option, 'selected', selected); if (selected) matched = true; } } },
    });
    if (name === 'option') {
      let selected = false, dirty = false;
      Object.defineProperties(node, {
        value: { configurable: true, get: () => node.getAttribute('value') ?? node.textContent, set: (value: string) => node.setAttribute('value', String(value)) },
        selected: { configurable: true, get: () => dirty ? selected : node.getAttribute('selected') !== null, set: (value: boolean) => { selected = Boolean(value); dirty = true; if (selected) { let parent = node.parentNode; while (parent && parent.tagName !== 'SELECT') parent = parent.parentNode; if (parent) for (const option of parent.querySelectorAll('option')) if (option !== node) Reflect.set(option, 'selected', false); } } },
        defaultSelected: { configurable: true, get: () => node.getAttribute('selected') !== null, set: (value: boolean) => { if (value) node.setAttribute('selected', ''); else node.removeAttribute('selected'); } },
      });
    }
    return node;
  };
  ({ createRoot } = await import('react-dom/client')); ({ TableFilteredExportDialog: Dialog } = await import('../../src/renderer/components/TableFilteredExportDialog'));
});
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined; } document.body.textContent = ''; vi.restoreAllMocks(); });
afterAll(() => { for (const [key, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });

const source = (): TableInfo => ({ database: 'd', name: 'subject', objectKind: 'table', engine: 'InnoDB', ddl: 'CREATE TABLE subject(id BIGINT,g INT GENERATED ALWAYS AS(1))', columns: [{ name: 'id', type: 'BIGINT', nullable: false, generated: false, defaultValue: null, extra: '', comment: '' }, { name: 'g', type: 'INT', nullable: true, generated: true, defaultValue: null, extra: 'GENERATED', comment: '' }], indexes: [], primaryKey: ['id'], editableKey: ['id'], foreignKeys: [] });
/** 原chooser、导出及取消分别由各自Promise驱动，进度事件不能伪造完整落盘。 */
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function mount(override: Partial<TableFilteredExportServices> = {}, objectKind: 'table' | 'view' = 'table', definition: TableInfo = source()) {
  let allowed = true; const info = definition; info.objectKind = objectKind; if (objectKind === 'view') info.engine = '';
  const intent = new TableFilteredExportIntent({ connectionId: 'c', database: 'd', table: 'subject' }, info, { filters: [{ column: 'id', operator: '>=', value: '9007199254740993', enabled: false }], filterMode: 'all' }, [{ column: 'id', direction: 'DESC' }], [], () => allowed);
  const choose = vi.fn(async (_input: Parameters<TableFilteredExportServices['choose']>[0]): Promise<FileChoice | null> => ({ token: 'file-token', name: 'synthetic.csv' })), execute = vi.fn(async (_input: Parameters<TableFilteredExportServices['execute']>[0]): Promise<TableFilteredExportOutput> => ({ rows: 1105, fileCommitted: true })), cancel = vi.fn(async (_id: string) => undefined), listeners = new Set<(event: TaskEvent) => void>();
  const services: TableFilteredExportServices = { choose, execute, cancel, subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, ...override };
  const onClose = vi.fn(), onCleanupError = vi.fn(), onActivity = vi.fn((_delta: 1 | -1) => undefined), onCommitted = vi.fn((_output: TableFilteredExportOutput, _changed: boolean) => undefined);
  let props = { intent, services, onClose, onCleanupError, onActivity, onCommitted };
  const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as unknown as Element); const render = () => root!.render(<Dialog {...props}/>); await act(async () => render());
  return { intent, info, choose, execute, cancel, services, onClose, onCleanupError, onActivity, onCommitted, async allowed(value: boolean) { allowed = value; await act(async () => render()); }, async invalidate() { await act(async () => intent.invalidate()); }, async replaceIntent() { props = { ...props, intent: new TableFilteredExportIntent(intent.target, source(), intent.conditions, intent.sort, [], () => true) }; await act(async () => render()); }, async emit(event: TaskEvent) { await act(async () => { for (const listener of listeners) listener(event); }); }, async render() { await act(async () => render()); } };
}
function button(label: string): MemoryNode { const node = document.querySelectorAll('button').find(item => item.textContent === label); expect(node, label).toBeDefined(); return node!; }
function picker(): MemoryNode { const node = document.querySelectorAll('button').find(item => item.classList.contains('file-picker')); expect(node).toBeDefined(); return node!; }
function select(label: string): MemoryNode { const node = document.querySelectorAll('select').find(item => item.getAttribute('aria-label') === label); expect(node, label).toBeDefined(); return node!; }
function callback(node: MemoryNode, name = 'onClick'): (...args: unknown[]) => unknown { const key = Object.keys(node).find(value => value.startsWith('__reactProps$')); if (!key) throw Error('缺少真实React事件'); const handler = (Reflect.get(node, key) as Record<string, unknown>)[name]; if (typeof handler !== 'function') throw Error('缺少真实回调'); return handler as (...args: unknown[]) => unknown; }
async function click(label: string): Promise<void> { const node = button(label); expect(node.disabled).toBe(false); await act(async () => { node.dispatchEvent(new MemoryEvent('click')); }); }
async function chooseFile(): Promise<void> { const node = picker(); expect(node.disabled).toBe(false); await act(async () => { node.dispatchEvent(new MemoryEvent('click')); }); }
async function change(label: string, value: string): Promise<void> { const node = select(label); expect(node.disabled).toBe(false); await act(async () => { node.value = value; node.dispatchEvent(new MemoryEvent('change')); }); }

/** 增加一个普通文本字段，仅供字段投影用例；原有两列夹具与全部旧断言保持。 */
function projectionSource(): TableInfo { const info = source(); info.columns.splice(1, 0, { ...info.columns[0], name: 'name', type: 'VARCHAR(80)', nullable: true }); return info; }
function field(name: string): MemoryNode { const node = document.querySelectorAll('input').find(item => item.getAttribute('aria-label') === '导出字段 ' + name); expect(node, '导出字段 ' + name).toBeDefined(); return node!; }
function moveButton(name: string, direction: '上移' | '下移'): MemoryNode { const label = direction + '导出字段 ' + name, node = document.querySelectorAll('button').find(item => item.getAttribute('aria-label') === label); expect(node, label).toBeDefined(); return node!; }
/** checkbox使用当前正式onChange，方向使用真实按钮事件；不写组件草稿或调用意图内部方法。 */
async function checkField(name: string, checked: boolean): Promise<void> { const node = field(name); expect(node.disabled).toBe(false); await act(async () => { callback(node, 'onChange')({ target: { checked } }); }); expect(field(name).checked).toBe(checked); }
async function moveField(name: string, direction: '上移' | '下移'): Promise<void> { const node = moveButton(name, direction); expect(node.disabled).toBe(false); await act(async () => { node.dispatchEvent(new MemoryEvent('click')); }); }
function orderedFields(): string[] { const list = document.querySelector('[aria-label="已选字段顺序"]'); expect(list).not.toBeNull(); return list!.querySelectorAll('button').map(node => node.getAttribute('aria-label') ?? '').filter(label => label.startsWith('上移导出字段 ')).map(label => label.slice('上移导出字段 '.length)); }

describe('全量筛选行正式对话框真实React RAM（非原生文件/数据库验收）', () => {
  it('初始只显示完整范围和所有字段，不读取数据、不选择文件、不执行', async () => { const f = await mount(); expect(document.querySelector('[data-table-filtered-export-dialog]')).not.toBeNull(); expect(document.body.textContent).toContain(text.scope); expect(document.body.textContent).toContain(text.committedOnly); expect(document.body.textContent).toContain(text.disabled); expect(document.body.textContent).toContain('9007199254740993'); expect(document.body.textContent).toContain(text.generated); expect(f.choose).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled(); expect(button(text.start).disabled).toBe(true); });
  it('准确格式export chooser令牌与完整原条件排序传入，1105行不截样本', async () => { const f = await mount(); await chooseFile(); expect(f.choose).toHaveBeenCalledExactlyOnceWith({ purpose: 'export', format: 'csv', suggestedName: 'subject-filtered.csv' }); expect(f.execute).not.toHaveBeenCalled(); await click(text.start); expect(f.execute).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ connectionId: 'c', database: 'd', table: 'subject', metadataKey: f.intent.metadataKey, filters: f.intent.conditions.filters, filterMode: 'all', sort: f.intent.sort, format: 'csv', encoding: 'utf8', csvDelimiter: ',', fileToken: 'file-token', taskId: expect.any(String) })); expect(document.body.textContent).toContain(text.completed(1105)); expect(f.onActivity.mock.calls).toEqual([[1], [-1], [1], [-1]]); expect(button(text.start).disabled).toBe(true); });
  it.each(['json', 'sql', 'xlsx'])('四格式都显式重新选文件且非CSV不夹带分隔符 %s', async format => { const f = await mount(); await chooseFile(); await change(text.format, format); expect(button(text.start).disabled).toBe(true); await chooseFile(); await click(text.start); const input = f.execute.mock.calls[0][0]; expect(input.format).toBe(format); expect(Object.hasOwn(input, 'csvDelimiter')).toBe(false); if (format === 'sql') expect(document.body.textContent).toContain(text.sqlScope); });
  it('文本编码/CSV分隔符变化撤销文件，XLSX固定UTF8并禁用文本编码', async () => { const f = await mount(); await chooseFile(); await change(csvText.label, ';'); expect(button(text.start).disabled).toBe(true); await change(text.encoding, 'gb18030'); await chooseFile(); await click(text.start); expect(f.execute.mock.calls[0][0]).toMatchObject({ encoding: 'gb18030', csvDelimiter: ';' }); await change(text.format, 'xlsx'); expect(select(text.encoding).disabled).toBe(true); expect(select(text.encoding).value).toBe('utf8'); expect(document.body.textContent).toContain(text.xlsxEncoding); });
  it('旧选择按钮/格式回调在配置ABA后不能领取后继文件能力', async () => { const f = await mount(), oldPick = callback(picker()), oldFormat = callback(select(text.format), 'onChange'); await change(text.format, 'json'); await change(text.format, 'csv'); await act(async () => { oldPick(); oldFormat({ target: { value: 'sql' } }); }); expect(f.choose).not.toHaveBeenCalled(); expect(select(text.format).value).toBe('csv'); });
  it('chooser等待期间源失效，迟到文件不发布且原选择未终结前不释放占用', async () => { const pending = deferred<FileChoice | null>(), f = await mount({ choose: vi.fn(() => pending.promise) }); await chooseFile(); expect(f.onActivity.mock.calls).toEqual([[1]]); await f.invalidate(); expect(picker().disabled).toBe(true); await act(async () => pending.resolve({ token: 'late', name: 'late.csv' })); expect(button(text.start).disabled).toBe(true); expect(document.body.textContent).not.toContain('late.csv'); expect(f.onActivity.mock.calls).toEqual([[1], [-1]]); expect(f.execute).not.toHaveBeenCalled(); });
  it('chooser等待中关闭不假装取消数据库，原chooser终结后才关闭', async () => { const pending = deferred<FileChoice | null>(), f = await mount({ choose: vi.fn(() => pending.promise) }); await chooseFile(); await click(text.close); expect(f.onClose).not.toHaveBeenCalled(); expect(f.cancel).not.toHaveBeenCalled(); await act(async () => pending.resolve({ token: 'late', name: 'late.csv' })); expect(f.onClose).toHaveBeenCalledOnce(); expect(f.onActivity.mock.calls).toEqual([[1], [-1]]); expect(f.execute).not.toHaveBeenCalled(); });
  it('选择被取消不清已有文件，也不自动导出', async () => { const f = await mount(); await chooseFile(); f.choose.mockResolvedValueOnce(null); await chooseFile(); expect(picker().textContent).toContain('synthetic.csv'); expect(f.execute).not.toHaveBeenCalled(); await click(text.start); expect(f.execute.mock.calls[0][0].fileToken).toBe('file-token'); });
  it('取消ACK先结束不能解锁原导出，失败后显式重选文件', async () => { const pending = deferred<TableFilteredExportOutput>(), ack = deferred<unknown>(), run = vi.fn(() => pending.promise), f = await mount({ execute: run, cancel: vi.fn(() => ack.promise) }); await chooseFile(); await click(text.start); await click(text.cancel); await act(async () => ack.resolve(undefined)); expect(picker().disabled).toBe(true); expect(f.onActivity.mock.calls).toEqual([[1], [-1], [1]]); await act(async () => pending.reject(Error('原导出已取消'))); expect(f.onActivity.mock.calls).toEqual([[1], [-1], [1], [-1]]); expect(button(text.start).disabled).toBe(true); expect(f.onClose).not.toHaveBeenCalled(); expect(document.body.textContent).toContain('原导出已取消'); });
  it('原导出先结束仍等待取消ACK，关闭不重复取消或提前释放', async () => { const pending = deferred<TableFilteredExportOutput>(), ack = deferred<unknown>(), cancel = vi.fn(() => ack.promise), f = await mount({ execute: vi.fn(() => pending.promise), cancel }); await chooseFile(); await click(text.start); await click(text.cancel); await act(async () => pending.reject(Error('原任务终结'))); expect(picker().disabled).toBe(true); expect(f.onActivity.mock.calls).toEqual([[1], [-1], [1]]); await click(text.close); expect(f.onClose).not.toHaveBeenCalled(); expect(cancel).toHaveBeenCalledOnce(); await act(async () => ack.resolve(undefined)); expect(f.onClose).toHaveBeenCalledOnce(); expect(f.onActivity.mock.calls).toEqual([[1], [-1], [1], [-1]]); });
  it('晚取消后的fileCommitted成功仍显示完整事实，不把它变成失败或重试', async () => { const pending = deferred<TableFilteredExportOutput>(), ack = deferred<unknown>(), f = await mount({ execute: vi.fn(() => pending.promise), cancel: vi.fn(() => ack.promise) }); await chooseFile(); await click(text.start); await click(text.cancel); await act(async () => pending.resolve({ rows: 1105, fileCommitted: true })); expect(document.body.textContent).toContain(text.completed(1105)); expect(picker().disabled).toBe(true); await act(async () => ack.resolve(undefined)); expect(button(text.start).disabled).toBe(true); expect(f.onActivity.mock.calls).toEqual([[1], [-1], [1], [-1]]); });
  it('源失效后成功回执保留已落盘事实并通知父级，旧来源不能再次执行', async () => { const pending = deferred<TableFilteredExportOutput>(), f = await mount({ execute: vi.fn(() => pending.promise) }); await chooseFile(); await click(text.start); await f.invalidate(); expect(f.cancel).toHaveBeenCalledOnce(); await act(async () => pending.resolve({ rows: 4, fileCommitted: true })); expect(document.body.textContent).toContain(text.committedChanged(4)); expect(f.onCommitted).toHaveBeenCalledWith({ rows: 4, fileCommitted: true }, true); expect(button(text.start).disabled).toBe(true); });
  it('关闭等待中成功仍向父级报告实际落盘，不更新后继窗口', async () => { const pending = deferred<TableFilteredExportOutput>(), f = await mount({ execute: vi.fn(() => pending.promise) }); await chooseFile(); await click(text.start); await click(text.close); await act(async () => pending.resolve({ rows: 4, fileCommitted: true })); expect(f.onCommitted).toHaveBeenCalledWith({ rows: 4, fileCommitted: true }, false); expect(f.onClose).toHaveBeenCalledOnce(); });
  it('TaskEvent completed不替代IPC与原文件资源收尾，另task事件忽略', async () => { const pending = deferred<TableFilteredExportOutput>(), run = vi.fn((_input: Parameters<TableFilteredExportServices['execute']>[0]) => pending.promise), f = await mount({ execute: run }); await chooseFile(); await click(text.start); const id = run.mock.calls[0][0].taskId; await f.emit({ taskId: 'other', status: 'completed', progress: 100, message: '不属于本例' }); expect(document.body.textContent).not.toContain('不属于本例'); await f.emit({ taskId: id, status: 'completed', progress: 100, message: '原任务事件已到' }); expect(document.body.textContent).toContain('原任务事件已到'); expect(document.body.textContent).not.toContain(text.completed(1105)); expect(picker().disabled).toBe(true); await act(async () => pending.resolve({ rows: 1105, fileCommitted: true })); expect(document.body.textContent).toContain(text.completed(1105)); });
  it('取消请求错误汇报父级但不提前释放原导出', async () => { const pending = deferred<TableFilteredExportOutput>(), f = await mount({ execute: vi.fn(() => pending.promise), cancel: vi.fn(async () => { throw Error('取消网络错误'); }) }); await chooseFile(); await click(text.start); await click(text.cancel); expect(f.onCleanupError).toHaveBeenCalledWith('取消网络错误'); expect(picker().disabled).toBe(true); await act(async () => pending.reject(Error('原导出结束'))); expect(picker().disabled).toBe(false); expect(button(text.start).disabled).toBe(true); });
  it('同组件替换意图不能复用已选文件，旧close回调不消耗新草稿', async () => { const f = await mount(); await chooseFile(); const old = callback(button(text.close)); await f.replaceIntent(); expect(button(text.start).disabled).toBe(true); await act(async () => old()); expect(f.onClose).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled(); await click(text.close); expect(f.onClose).toHaveBeenCalledOnce(); });
  it('视图SQL选项禁用且程序投递也拒绝，CSVJSONXLSX保持正式入口', async () => {
    const f = await mount({}, 'view'); expect(select(text.format).querySelectorAll('option').find(option => option.value === 'sql')!.disabled).toBe(true); expect(document.body.textContent).toContain(text.viewSql);
    await act(async () => callback(select(text.format), 'onChange')({ target: { value: 'sql' } })); expect(select(text.format).value).toBe('csv'); expect(f.choose).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled();
    await change(text.format, 'json'); await chooseFile(); await click(text.start); expect(f.execute.mock.calls[0][0].format).toBe('json');
  });
});

describe('全部筛选行导出字段选择及顺序真实React RAM', () => {
  it('默认全选并按元数据顺序展示，清空拒绝chooser和执行，显式全选可恢复', async () => {
    const f = await mount({}, 'table', projectionSource());
    expect(['id', 'name', 'g'].map(name => field(name).checked)).toEqual([true, true, true]); expect(orderedFields()).toEqual(['id', 'name', 'g']);
    await click('清空字段选择'); expect(orderedFields()).toEqual([]); expect(picker().disabled).toBe(true); expect(button(text.start).disabled).toBe(true);
    expect(document.body.textContent).toContain(text.emptyFields);
    expect(f.choose).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled();
    await click('选择全部字段'); expect(orderedFields()).toEqual(['id', 'name', 'g']); expect(picker().disabled).toBe(false); expect(button(text.start).disabled).toBe(true);
  });
  it.each(['csv', 'json', 'sql', 'xlsx'] as const)('%s仅将明确两列及所选顺序交给execute，原全量条件和排序不变', async format => {
    const f = await mount({}, 'table', projectionSource()); if (format !== 'csv') await change(text.format, format);
    await click('清空字段选择'); await checkField('id', true); await checkField('name', true); await moveField('name', '上移');
    expect(orderedFields()).toEqual(['name', 'id']); expect(moveButton('name', '上移').disabled).toBe(true); expect(moveButton('id', '下移').disabled).toBe(true);
    await chooseFile(); await click(text.start);
    expect(f.execute).toHaveBeenCalledOnce(); expect(f.execute.mock.calls[0][0]).toMatchObject({ columns: ['name', 'id'], format, filters: f.intent.conditions.filters, filterMode: 'all', sort: f.intent.sort, fileToken: 'file-token' });
    expect(f.intent.source.columns.map(column => column.name)).toEqual(['id', 'name', 'g']);
  });
  it('改选及移动各自消费旧文件，修回原选择也不能复用令牌或原按钮闭包', async () => {
    const f = await mount({}, 'table', projectionSource()); await chooseFile(); const oldStart = callback(button(text.start)), oldField = callback(field('name'), 'onChange');
    await checkField('name', false); expect(button(text.start).disabled).toBe(true); await checkField('name', true);
    await act(async () => { oldStart(); oldField({ target: { checked: false } }); });
    expect(field('name').checked).toBe(true); expect(f.execute).not.toHaveBeenCalled(); expect(button(text.start).disabled).toBe(true);
    await chooseFile(); const before = orderedFields(); await moveField(before[1], '上移'); expect(button(text.start).disabled).toBe(true);
    await chooseFile(); await click(text.start); expect(f.execute).toHaveBeenCalledOnce(); expect(f.choose).toHaveBeenCalledTimes(3);
  });
  it('旧上下移回调不能在顺序ABA后改写新草稿，原文件不复活', async () => {
    const f = await mount({}, 'table', projectionSource()); await chooseFile(); const oldUp = callback(moveButton('name', '上移'));
    await moveField('name', '上移'); await moveField('name', '下移'); expect(orderedFields()).toEqual(['id', 'name', 'g']);
    await act(async () => oldUp()); expect(orderedFields()).toEqual(['id', 'name', 'g']); expect(button(text.start).disabled).toBe(true); expect(f.execute).not.toHaveBeenCalled();
  });
  it('chooser与导出原Promise等待期间全部选列控件禁用，旧事件和双击不能绕过占用', async () => {
    const choice = deferred<FileChoice | null>(), result = deferred<TableFilteredExportOutput>(), choose = vi.fn(() => choice.promise), execute = vi.fn((_input: Parameters<TableFilteredExportServices['execute']>[0]) => result.promise), f = await mount({ choose, execute }, 'table', projectionSource());
    const oldPick = callback(picker()), oldField = callback(field('name'), 'onChange'), oldMove = callback(moveButton('name', '上移'));
    await act(async () => { oldPick(); oldPick(); }); expect(choose).toHaveBeenCalledOnce();
    for (const name of ['id', 'name', 'g']) expect(field(name).disabled).toBe(true);
    expect(moveButton('name', '上移').disabled).toBe(true); expect(button('选择全部字段').disabled).toBe(true); expect(button('清空字段选择').disabled).toBe(true);
    await act(async () => { oldField({ target: { checked: false } }); oldMove(); }); expect(orderedFields()).toEqual(['id', 'name', 'g']);
    await act(async () => choice.resolve({ token: 'exact', name: 'chosen.csv' })); const start = callback(button(text.start)), currentField = callback(field('name'), 'onChange');
    await act(async () => { start(); start(); currentField({ target: { checked: false } }); }); expect(execute).toHaveBeenCalledOnce(); expect(execute.mock.calls[0][0].columns).toEqual(['id', 'name', 'g']);
    expect(field('name').disabled).toBe(true); expect(moveButton('name', '上移').disabled).toBe(true); expect(f.onActivity.mock.calls).toEqual([[1], [-1], [1]]);
    await act(async () => result.resolve({ rows: 1105, fileCommitted: true })); expect(f.onActivity.mock.calls).toEqual([[1], [-1], [1], [-1]]);
  });
  it('来源失效再恢复不允许旧选列或文件闭包修改后继意图', async () => {
    const f = await mount({}, 'table', projectionSource()); await chooseFile(); const oldField = callback(field('name'), 'onChange'), oldMove = callback(moveButton('name', '上移')), oldStart = callback(button(text.start));
    await f.allowed(false); await f.allowed(true); await act(async () => { oldField({ target: { checked: false } }); oldMove(); oldStart(); });
    expect(orderedFields()).toEqual(['id', 'name', 'g']); expect(f.execute).not.toHaveBeenCalled(); expect(picker().disabled).toBe(true);
    await f.replaceIntent(); await act(async () => { oldField({ target: { checked: false } }); oldMove(); oldStart(); }); expect(f.execute).not.toHaveBeenCalled(); expect(button(text.start).disabled).toBe(true);
  });
  it('切SQL明确排除生成列且禁选，旧CSV回调不能加回；切格式仍需重选文件', async () => {
    const f = await mount({}, 'table', projectionSource()); await chooseFile(); const oldGenerated = callback(field('g'), 'onChange');
    await change(text.format, 'sql'); expect(field('g').disabled).toBe(true); expect(field('g').checked).toBe(false); expect(document.body.textContent).toContain(text.generated); expect(orderedFields()).toEqual(['id', 'name']); expect(button(text.start).disabled).toBe(true);
    await act(async () => oldGenerated({ target: { checked: true } })); expect(field('g').checked).toBe(false);
    await chooseFile(); await click(text.start); expect(f.execute.mock.calls[0][0]).toMatchObject({ format: 'sql', columns: ['id', 'name'] });
    await change(text.format, 'json'); expect(field('g').disabled).toBe(false); await checkField('g', true); expect(button(text.start).disabled).toBe(true);
  });
});
