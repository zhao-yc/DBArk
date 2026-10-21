import { act } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueryResult, ResultExportData } from '../../src/shared/contracts';
import { validateCommand } from '../../src/shared/validation';
import { resultExcelZh as text } from '../../src/shared/resultExcel.zh-CN';
import { resultSqlZh as sqlText } from '../../src/shared/resultSql.zh-CN';
import { previewResultSql } from '../../src/engine/resultSql';
import { ResultExportSelection } from '../../src/renderer/resultExport';
import { zh } from '../../src/renderer/locales/zh-CN';
import { csvExportZh } from '../../src/renderer/locales/csvExport.zh-CN';
import { memoryDocument, MemoryEvent } from '../fixtures/memory-dom';

// 只替代布局端口，正式ResultsGrid、导出对话框、选择快照和共享准入仍运行。
vi.mock('react-data-grid', () => ({ SelectColumn: { key: 'select-row' }, DataGrid: () => <div role="grid"/> }));
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let Dialog: typeof import('../../src/renderer/components/ResultExportDialog')['ResultExportDialog'], store: typeof import('../../src/renderer/store')['useWorkspace'];
beforeAll(async () => {
  document = memoryDocument(); (document as any).oninput = null; Object.assign(window, { setTimeout, clearTimeout }); const create = document.createElement.bind(document);
  document.createElement = name => {
    const node = create(name);
    if (name === 'input') { let kind = 'text'; Object.defineProperty(node, 'type', { configurable: true, get: () => kind, set: value => { kind = value; node.attributes.set('type', value); } }); }
    if (name === 'option') {
      let selected = false;
      Object.defineProperty(node, 'value', { configurable: true, get: () => node.attributes.get('value') ?? node.textContent, set: value => node.attributes.set('value', String(value)) });
      Object.defineProperty(node, 'selected', { get: () => selected, set: value => { selected = !!value; if (selected && node.parentNode?.tagName === 'SELECT') for (const option of node.parentNode.querySelectorAll('option')) if (option !== node) (option as any).selected = false; } });
    }
    if (name === 'select') {
      Object.defineProperty(node, 'options', { get: () => node.querySelectorAll('option') });
      Object.defineProperty(node, 'value', { configurable: true, get: () => node.querySelectorAll('option').find(option => (option as any).selected)?.value ?? '', set: value => { for (const option of node.querySelectorAll('option')) (option as any).selected = option.value === value; } });
    }
    const set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node);
    node.setAttribute = (key, value) => { set(key.toLowerCase(), value); if (key === 'disabled') node.disabled = true; };
    node.removeAttribute = key => { remove(key.toLowerCase()); if (key === 'disabled') node.disabled = false; }; return node;
  };
  ({ createRoot } = await import('react-dom/client')); ({ ResultExportDialog: Dialog } = await import('../../src/renderer/components/ResultExportDialog')); ({ useWorkspace: store } = await import('../../src/renderer/store'));
});
beforeEach(() => { document.body.textContent = ''; store.setState({ tasks: [], activeJobs: {}, connectionVersions: {}, connections: [] }); });
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; delete (window as any).dbark; vi.restoreAllMocks(); });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });

/** 原控制器提供完整或勾选快照；隐藏列和原SQL始终不进入文件请求。 */
function fixture(selected: boolean, prepare?: (source: QueryResult) => void) {
  const source: QueryResult = { columns: [
    { key: 'id', name: '重名', type: 'BIGINT' }, { key: 'amount', name: '重名', type: 'DECIMAL(30,20)' },
    { key: 'date', name: '日期', type: 'DATETIME' }, { key: 'bool', name: '布尔', type: 'TINYINT' },
    { key: 'nullable', name: '可空', type: 'VARCHAR' }, { key: 'bytes', name: '字节', type: 'BLOB' }, { key: 'hidden', name: '隐藏', type: 'VARCHAR' },
  ], rows: Array.from({ length: 25 }, (_, index) => ({ id: String(9007199254740993n + BigInt(index)), amount: '0.12345678901234567890', date: '2026-10-23 01:02:03.123456', bool: index % 2 === 0, nullable: index === 0 ? null : index === 1 ? '' : index === 2 ? '\\N' : index === 3 ? '\\B:AP8=' : '=SUM(A1:A2)', bytes: { type: 'binary' as const, base64: 'AP8=' }, hidden: '不能导出' })), elapsedMs: 1, truncated: true, statement: 'SELECT 不能传给已返回结果导出的原SQL' };
  prepare?.(source);
  const controller = new ResultExportSelection(), binding = controller.bind(source, ['结果ExcelRAM'], source.columns.slice(0, -1))!;
  if (selected) controller.select(binding, { scope: binding, columns: binding.visibleColumns, rows: source.rows, indices: new Set([24, 1]) });
  return { source, snapshot: selected ? controller.snapshot(binding) : controller.allSnapshot(binding) };
}
/** IPC只替代原生保存端口，所有请求过真实共享schema，SQL预览也使用正式有界生成器。 */
async function mount(options: { selected?: boolean; prepare?: (source: QueryResult) => void; choose?: () => Promise<unknown>; export?: () => Promise<unknown> } = {}) {
  const data = fixture(options.selected ?? false, options.prepare); let sequence = 0;
  const invoke = vi.fn(async (command: string, input: any): Promise<any> => {
    if (command === 'files.choose') { validateCommand(command, input); return options.choose ? options.choose() : { token: `file-${++sequence}`, name: '结果.' + input.format }; }
    if (command === 'files.exportResult') { validateCommand(command, input); return options.export ? options.export() : { rows: input.result.rows.length }; }
    if (command === 'files.previewResultSql') { validateCommand(command, input); return { ...previewResultSql(input.result, input.target), previewId: '11111111-1111-4111-8111-111111111111', expiresAt: new Date(Date.now() + 120000).toISOString() }; }
    if (command === 'files.releaseResultSql') { validateCommand(command, input); return; }
    if (command === 'query.cancel') { validateCommand(command, input); return; }
    throw Error('禁止数据库或其它外界调用：' + command);
  });
  (window as any).dbark = { invoke }; const onClose = vi.fn(); let shown: ResultExportData = data.snapshot;
  const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as any);
  async function render(result = shown) { shown = result; await act(async () => root!.render(<Dialog result={shown} tabId="offline-result" selected={options.selected} onClose={onClose}/>)); }
  await render(); return { ...data, invoke, onClose, render, requests: (command: string) => invoke.mock.calls.filter(call => call[0] === command) };
}
function node(label: string) { const value = document.querySelector(`[aria-label="${label}"]`); expect(value, label).not.toBeNull(); return value!; }
function button(label: string) { const value = document.querySelectorAll('button').find(item => item.textContent === label || item.textContent.includes(label)); expect(value, label).toBeDefined(); return value!; }
function picker() { return document.querySelectorAll('button').find(item => item.getAttribute('class') === 'file-picker')!; }
function execute() { return document.querySelectorAll('button').find(item => item.getAttribute('class') === 'primary')!; }
/** 捕获真实旧闭包，校验格式ABA、旧编码和迟到文件不能越过原revision门。 */
function callback(value: ReturnType<typeof node>, event = 'onClick') { const key = Object.keys(value).find(key => key.startsWith('__reactProps$')); if (!key) throw Error('缺少真实React事件'); return (value as any)[key][event] as (event?: any) => void; }
async function click(value: ReturnType<typeof node>) { expect(value.disabled).toBe(false); await act(async () => value.dispatchEvent(new MemoryEvent('click'))); }
async function select(label: string, value: string) { const element = node(label); expect(element.disabled).toBe(false); await act(async () => { element.value = value; element.dispatchEvent(new MemoryEvent('change')); }); }
async function input(label: string, value: string) { const element = node(label); await act(async () => { element.value = value; element.dispatchEvent(new MemoryEvent('input')); }); }
function deferred() { let resolve!: (value: unknown) => void, reject!: (reason: Error) => void; const promise = new Promise<unknown>((ok, fail) => { resolve = ok; reject = fail; }); return { promise, resolve, reject }; }
async function xlsx() { await select(zh.resultExport.format, 'xlsx'); }
async function prepareSql(columns: number) {
  await select(zh.resultExport.format, 'sql'); await input(sqlText.database, 'db'); await input(sqlText.table, 't');
  for (let index = 1; index <= columns; index++) await input(sqlText.column(index), 'c' + index);
  await click(button(sqlText.preview));
}

describe('已返回结果Excel的真实导出对话框', () => {
  it('新增XLSX格式选项并说明固定编码、文本数值日期与完整dbark-v1协议', async () => {
    await mount(); expect(node(zh.resultExport.format).querySelectorAll('option').map(option => option.value)).toEqual(['csv', 'json', 'sql', 'xlsx']);
    await select(zh.resultExport.encoding, 'utf16le'); await xlsx(); expect(node(zh.resultExport.encoding).disabled).toBe(true); expect(node(zh.resultExport.encoding).value).toBe('utf8');
    for (const message of [text.encoding, text.notice, text.numbers, text.nulls, text.binary, text.limits]) expect(document.body.textContent).toContain(message);
    expect(document.querySelector(`[aria-label="${csvExportZh.label}"]`)).toBeNull(); expect(document.querySelector(`pre[aria-label="${sqlText.preview}"]`)).toBeNull();
  });

  it('离线完整25行快照按原值送出xlsx，示例20行不会限制最终范围', async () => {
    const f = await mount(); const expected = { columns: f.snapshot.columns.map(({ key, name }) => ({ key, name })), rows: structuredClone(f.snapshot.rows), truncated: f.snapshot.truncated }; await xlsx(); f.source.rows[24].amount = '后来源变化'; await click(picker()); await click(execute());
    const request = f.requests('files.exportResult')[0][1]; expect(request).toMatchObject({ format: 'xlsx', encoding: 'utf8', fileToken: 'file-1' }); expect(request.result).toEqual(expected); expect(request.result.rows).toHaveLength(25);
    expect(request.result.rows[24].amount).toBe('0.12345678901234567890'); expect(request.result.rows[0].bool).toBe(true); expect(request.result.rows[0].nullable).toBeNull(); expect(request.result.rows[1].nullable).toBe('');
    expect(request).not.toHaveProperty('connectionId'); expect(request).not.toHaveProperty('sql'); expect(request).not.toHaveProperty('csvDelimiter'); expect(request.result).not.toHaveProperty('statement');
    expect(f.invoke.mock.calls.map(call => call[0])).toEqual(['files.choose', 'files.exportResult']);
  });

  it('勾选快照只导出准确原行及可见列，不包含隐藏列或未选行', async () => {
    const f = await mount({ selected: true }); await xlsx(); await click(picker()); await click(execute());
    const data = f.requests('files.exportResult')[0][1].result; expect(data.rows).toEqual(f.snapshot.rows); expect(data.truncated).toBe(f.snapshot.truncated); expect(data.rows).toHaveLength(2); expect(data.rows.map((row: any) => row.id)).toEqual([f.source.rows[1].id, f.source.rows[24].id]);
    expect(data.columns.map((column: any) => column.key)).toEqual(['id', 'amount', 'date', 'bool', 'nullable', 'bytes']); expect(data.rows.every((row: any) => !Object.hasOwn(row, 'hidden'))).toBe(true);
  });

  it('禁用编码既拒旧事件也拒当前伪造事件，选择文件后仍固定utf8且不撤销正确授权', async () => {
    const f = await mount(); const oldEncoding = callback(node(zh.resultExport.encoding), 'onChange'); await xlsx(); await click(picker());
    const currentEncoding = callback(node(zh.resultExport.encoding), 'onChange'); await act(async () => { oldEncoding({ target: { value: 'gb18030' } }); currentEncoding({ target: { value: 'utf16le' } }); });
    expect(node(zh.resultExport.encoding).value).toBe('utf8'); expect(execute().disabled).toBe(false); await click(execute()); expect(f.requests('files.exportResult')[0][1].encoding).toBe('utf8');
  });

  it('保留过非默认CSV分隔符也不能夹带到xlsx，选择文件建议扩展名准确', async () => {
    const f = await mount(); await select(csvExportZh.label, ';'); await select(zh.resultExport.encoding, 'gb18030'); await xlsx(); await click(picker()); await click(execute());
    expect(f.requests('files.choose')[0][1]).toEqual({ purpose: 'export', format: 'xlsx', suggestedName: `${zh.resultExport.defaultName}.xlsx` });
    const value = f.requests('files.exportResult')[0][1]; expect(value.encoding).toBe('utf8'); expect(Object.keys(value).sort()).toEqual(['encoding', 'fileToken', 'format', 'result', 'taskId']);
  });

  it('SQL预览切xlsx精确释放旧能力，旧预览和旧文件不能进入Excel请求', async () => {
    const f = await mount(); await prepareSql(f.snapshot.columns.length); await click(picker()); const oldExecute = callback(execute()); await xlsx();
    expect(f.requests('files.releaseResultSql')).toHaveLength(1); expect(execute().disabled).toBe(true); await click(picker()); await act(async () => oldExecute()); expect(f.requests('files.exportResult')).toHaveLength(0);
    await click(execute()); expect(f.requests('files.exportResult')[0][1]).not.toHaveProperty('sql'); expect(f.requests('files.choose')[1][1]).not.toHaveProperty('resultSqlPreviewId');
  });

  it('xlsx格式ABA和重新选文件后旧执行与旧选择回调不能复活授权', async () => {
    const f = await mount(); await xlsx(); await click(picker()); const oldExecute = callback(execute()), oldPick = callback(picker()); await select(zh.resultExport.format, 'json'); await xlsx();
    expect(execute().disabled).toBe(true); await click(picker()); const choiceCount = f.requests('files.choose').length; await act(async () => { oldExecute(); oldPick(); });
    expect(f.requests('files.choose')).toHaveLength(choiceCount); expect(f.requests('files.exportResult')).toHaveLength(0); await click(execute()); expect(f.requests('files.exportResult')[0][1].fileToken).toBe('file-2');
  });

  it('迟到xlsx文件选择不能归属恢复后的同名格式', async () => {
    const held = deferred(), f = await mount({ choose: () => held.promise }); await xlsx(); await click(picker()); await select(zh.resultExport.format, 'csv'); await xlsx();
    await act(async () => held.resolve({ token: 'old', name: 'old.xlsx' })); expect(execute().disabled).toBe(true); expect(picker().textContent).not.toContain('old.xlsx'); expect(f.requests('files.exportResult')).toHaveLength(0);
  });

  it('迟到旧文件错误不污染新格式反馈或开启导出', async () => {
    const held = deferred(); await mount({ choose: () => held.promise }); await xlsx(); await click(picker()); await select(zh.resultExport.format, 'json'); await act(async () => held.reject(Error('旧xlsx失败')));
    expect(document.body.textContent).not.toContain('旧xlsx失败'); expect(execute().disabled).toBe(true);
  });

  it('第25行超32767字符也在选择文件前整份拒绝，原CSV仍可沿原预算导出', async () => {
    const f = await mount({ prepare: source => { source.rows[24].nullable = '甲'.repeat(32768); } }); await xlsx(); expect(picker().disabled).toBe(true); await act(async () => callback(picker())());
    expect(f.requests('files.choose')).toHaveLength(0); expect(document.querySelector('[role="alert"]')).not.toBeNull();
    await select(zh.resultExport.format, 'csv'); await click(picker()); await click(execute()); expect(f.requests('files.exportResult')[0][1].format).toBe('csv'); expect(f.requests('files.exportResult')[0][1].result.rows[24].nullable.length).toBe(32768);
  });

  it.each(['\u0000', '\u000b', '\ud800', '\ufffe'])('非法XML字符%s在原样例外也拒绝文件选择，不替换或截断', async invalid => {
    const f = await mount({ prepare: source => { source.rows[24].nullable = `原文${invalid}尾部`; } }); await xlsx(); expect(picker().disabled).toBe(true); await act(async () => callback(picker())()); expect(f.requests('files.choose')).toHaveLength(0); expect(f.requests('files.exportResult')).toHaveLength(0);
  });

  it('32767字符边界完整送出，不只保留预览或拆成多格', async () => {
    const value = '甲'.repeat(32767), f = await mount({ prepare: source => { source.rows[24].nullable = value; } }); await xlsx(); await click(picker()); await click(execute());
    expect(f.requests('files.exportResult')[0][1].result.rows[24].nullable).toBe(value);
  });

  it('列标题也做XML完整预检，坏标题不能先拿文件授权', async () => {
    const f = await mount({ prepare: source => { source.columns[0].name = '标题\u0001'; } }); await xlsx(); expect(picker().disabled).toBe(true); await act(async () => callback(picker())()); expect(f.requests('files.choose')).toHaveLength(0);
  });

  it('选择文件后快照原地漂移到非法XML，execute在busy及IPC前再次整份拒绝', async () => {
    const f = await mount(); await xlsx(); await click(picker()); f.snapshot.rows[24].nullable = '后来\u0000坏值'; await click(execute());
    expect(f.requests('files.exportResult')).toHaveLength(0); expect(store.getState().activeJobs['offline-result']).not.toBe(true); expect(document.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('写任务等待中沿原busy门禁用格式与关闭，旧编码事件不能污染提交', async () => {
    const held = deferred(), f = await mount({ export: () => held.promise }); await xlsx(); await click(picker()); const oldFormat = callback(node(zh.resultExport.format), 'onChange'); await click(execute());
    expect(node(zh.resultExport.format).disabled).toBe(true); expect(button(zh.common.close).disabled).toBe(true); await act(async () => oldFormat({ target: { value: 'csv' } })); expect(node(zh.resultExport.format).value).toBe('xlsx');
    await act(async () => held.resolve({ rows: 25 })); expect(f.requests('files.exportResult')).toHaveLength(1); expect(f.onClose).not.toHaveBeenCalled(); expect(button(zh.common.done)).toBeDefined();
  });

  it('取消原生文件选择不导出，窗口仍可再次选择并执行', async () => {
    let attempt = 0; const f = await mount({ choose: async () => ++attempt === 1 ? null : { token: 'second', name: 'second.xlsx' } }); await xlsx(); await click(picker()); expect(execute().disabled).toBe(true);
    await click(picker()); await click(execute()); expect(f.requests('files.exportResult')[0][1].fileToken).toBe('second');
  });

  it('关闭后旧xlsx选择和执行回调无权写入，替换结果对象也使原入口失效', async () => {
    const f = await mount(); await xlsx(); await click(picker()); const old = callback(execute()); await click(button(zh.common.close)); await act(async () => old()); expect(f.requests('files.exportResult')).toHaveLength(0);
    await f.render(structuredClone(f.snapshot)); expect(execute().disabled).toBe(true); expect(picker().disabled).toBe(true);
  });

  it('xlsx切回CSV恢复原编码/分隔符能力，最终请求保持原CSV协议', async () => {
    const f = await mount(); await select(csvExportZh.label, '\t'); await xlsx(); await select(zh.resultExport.format, 'csv'); expect(node(zh.resultExport.encoding).disabled).toBe(false);
    await select(zh.resultExport.encoding, 'utf16le'); await click(picker()); await click(execute()); expect(f.requests('files.exportResult')[0][1]).toMatchObject({ format: 'csv', encoding: 'utf16le', csvDelimiter: '\t' });
  });

  it('xlsx切回JSON保留原文本编码选择且不附CSV或SQL状态', async () => {
    const f = await mount(); await xlsx(); await select(zh.resultExport.format, 'json'); await select(zh.resultExport.encoding, 'gb18030'); await click(picker()); await click(execute());
    const value = f.requests('files.exportResult')[0][1]; expect(value).toMatchObject({ format: 'json', encoding: 'gb18030' }); expect(value).not.toHaveProperty('csvDelimiter'); expect(value).not.toHaveProperty('sql');
  });
});
