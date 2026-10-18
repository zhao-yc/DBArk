import { act, StrictMode } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memoryDocument, MemoryEvent } from '../fixtures/memory-dom';
import { resultSqlMain } from '../fixtures/result-sql-export';
import { resultSqlZh as text } from '../../src/shared/resultSql.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import { ResultExportSelection } from '../../src/renderer/resultExport';
import type { QueryResult } from '../../src/shared/contracts';
const database = vi.hoisted(() => ({ connect: vi.fn(), execute: vi.fn() }));
vi.mock('../../src/engine/connection', () => database);
// 仅网格显示由RAM替代；真实React表单、严格IPC、Main原文派发、预览授权和Engine文件写入均执行。
vi.mock('../../src/renderer/components/ResultsGrid', () => ({ ResultsGrid: () => null }));
import { Engine } from '../../src/engine';
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let Dialog: typeof import('../../src/renderer/components/ResultExportDialog')['ResultExportDialog'];
let main: ReturnType<typeof resultSqlMain>, engine: Engine, path: string, folder: string, snapshot: QueryResult;
let source: QueryResult, requests: { command: string; input: any; result?: any }[], writes: Promise<unknown>[], closed: ReturnType<typeof vi.fn>;
let hold: { command: string; promise: Promise<void>; release(): void } | undefined;
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
beforeAll(async () => {
  document = memoryDocument(); (document as any).oninput = null; Object.assign(window, { setTimeout, clearTimeout });
  const create = document.createElement.bind(document);
  document.createElement = name => {
    const node = create(name);
    if (name === 'input') { let kind = 'text'; Object.defineProperty(node, 'type', { configurable: true, get: () => kind, set: value => { kind = value; node.attributes.set('type', value); } }); node.type = 'text'; }
    if (name === 'option') Object.defineProperty(node, 'value', { configurable: true, get: () => node.attributes.get('value') ?? node.textContent, set: value => node.attributes.set('value', value) });
    if (name === 'select') { Object.defineProperty(node, 'options', { get: () => node.querySelectorAll('option') }); Object.defineProperty(node, 'value', { configurable: true, get: () => node.querySelectorAll('option').find(option => (option as any).selected)?.value ?? '', set: value => { for (const option of node.querySelectorAll('option')) (option as any).selected = option.value === value; } }); }
    const set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node);
    node.setAttribute = (key, value) => { set(key.toLowerCase(), value); if (key === 'disabled') node.disabled = true; }; node.removeAttribute = key => { remove(key.toLowerCase()); if (key === 'disabled') node.disabled = false; }; return node;
  };
  ({ createRoot } = await import('react-dom/client')); ({ ResultExportDialog: Dialog } = await import('../../src/renderer/components/ResultExportDialog'));
});
afterEach(async () => {
  hold?.release(); hold = undefined; if (root) { await act(async () => root!.unmount()); root = undefined; }
  await Promise.allSettled(writes ?? []); if (engine) await engine.closeAll(); delete (window as any).dbark;
  expect(database.connect).not.toHaveBeenCalled(); expect(database.execute).not.toHaveBeenCalled();
  if (folder) { for (const name of await readdir(folder)) await rm(join(folder, name)); await rmdir(folder); } vi.restoreAllMocks();
});
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
/** 结果投影与勾选均用原快照类，禁止把隐藏字段或原始查询传给文件链。 */
async function mount(selected = false, strict = false) {
  folder = await mkdtemp(join(tmpdir(), 'dbark-result-sql-ui-')); path = join(folder, 'selected.sql'); await writeFile(path, '原目标');
  source = { columns: [{ key: 'a', name: '重名', type: 'BIGINT' }, { key: 'b', name: '重名', type: 'BLOB' }, { key: 'hidden', name: '隐藏', type: 'TEXT' }], rows: [{ a: '18446744073709551615', b: { type: 'binary', base64: 'AP8=' }, hidden: '秘密' }, { a: '0.12345678901234567890', b: '', hidden: '秘密' }], statement: 'SELECT 原SQL不得传给导出', elapsedMs: 0, truncated: true };
  const owner = new ResultExportSelection(), binding = owner.bind(source, ['已返回'], source.columns.slice(0, 2))!;
  if (selected) { owner.select(binding, { scope: binding, columns: binding.visibleColumns, rows: source.rows, indices: new Set([1]) }); snapshot = owner.snapshot(binding); } else snapshot = owner.allSnapshot(binding);
  requests = []; writes = []; closed = vi.fn(); engine = new Engine(() => {}); main = resultSqlMain(path, (command, input) => engine.handle(command as any, input));
  (window as any).dbark = { onTask: () => () => {}, invoke(command: string, input: any) {
    const call = { command, input, result: undefined as any }; requests.push(call);
    const promise = main.invoke(command, input).then(async value => { call.result = value; if (hold?.command === command) await hold.promise; return value; });
    if (command === 'files.exportResult') writes.push(promise); return promise;
  } };
  const container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container as any);
  const dialog = <Dialog result={snapshot} tabId="q" selected={selected} onClose={closed}/>;
  await act(async () => root!.render(strict ? <StrictMode>{dialog}</StrictMode> : dialog));
}
function button(name: string) { const node = document.querySelectorAll('button').find(value => value.textContent === name || value.textContent.includes(name)); expect(node, name).toBeDefined(); return node!; }
async function click(name: string) { const node = button(name); expect(node.disabled, name).toBe(false); await act(async () => { node.dispatchEvent(new MemoryEvent('click')); }); }
async function input(name: string, value: string) { const node = document.querySelector(`input[aria-label="${name}"]`); expect(node, name).not.toBeNull(); await act(async () => { node!.value = value; node!.dispatchEvent(new MemoryEvent('input')); }); }
async function select(name: string, value: string) { const node = document.querySelector(`select[aria-label="${name}"]`)!; await act(async () => { node.value = value; node.dispatchEvent(new MemoryEvent('change')); }); }
function callback(node: any, event = 'onClick'): (value?: any) => void { const key = Object.keys(node).find(value => value.startsWith('__reactProps$')); if (!key) throw Error('缺少实际React回调'); return node[key][event]; }
async function target() { await select(zh.resultExport.format, 'sql'); await input(text.database, 'db'); await input(text.table, 't'); await input(text.column(1), 'n'); await input(text.column(2), 'b'); }
async function ready() { await click(text.preview); await click(zh.resultExport.chooseFile); await input(text.confirmation, 'db.t'); const node = document.querySelector(`input[aria-label="${text.acknowledge}"]`)!; await act(async () => { node.checked = true; node.dispatchEvent(new MemoryEvent('click')); }); }
function delay(command: string) { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); hold = { command, promise, release }; return hold; }

describe('结果INSERT真实React到文件链路（RAM原生端口）', () => {
  it.each([false, true])('全结果/勾选=%s：显式目标、实际SQL确认、一次提交及真实文件均只含可见快照', async selected => {
    await mount(selected); await target(); expect(button(zh.resultExport.chooseFile).disabled).toBe(true);
    await ready(); const sql = document.querySelector(`pre[aria-label="${text.preview}"]`)!.textContent; expect(sql).toContain('INSERT INTO `db`.`t` (`n`, `b`)'); expect(document.body.textContent).toContain('此结果已截断');
    const apply = callback(button(zh.resultExport.start)); await act(async () => { apply(); apply(); await Promise.all(writes); });
    expect(requests.filter(value => value.command === 'files.exportResult')).toHaveLength(1); expect(await readFile(path, 'utf8')).toBe(sql);
    const exported = requests.find(value => value.command === 'files.exportResult')!.input;
    expect(exported.result.rows).toHaveLength(selected ? 1 : 2); expect(exported.result.columns.map((value: any) => value.key)).toEqual(['a', 'b']); expect(exported).not.toHaveProperty('connectionId'); expect(exported.result).not.toHaveProperty('statement'); expect(exported.result.rows.every((row: any) => !Object.hasOwn(row, 'hidden'))).toBe(true);
    if (selected) expect(sql).not.toContain('3138343436373434303733373039353531363135'); expect(source.rows[0].hidden).toBe('秘密'); expect(main.files.size).toBe(0);
  });
  it('空名与重名映射阻止预览；明确库.表及风险确认未齐全时不能导出', async () => {
    await mount(); await select(zh.resultExport.format, 'sql'); await click(text.preview); expect(requests.some(value => value.command === 'files.previewResultSql')).toBe(false);
    await input(text.database, 'db'); await input(text.table, 't'); await input(text.column(1), 'n'); await input(text.column(2), 'N'); await click(text.preview); expect(requests.some(value => value.command === 'files.previewResultSql')).toBe(false);
    await input(text.column(2), 'b'); await click(text.preview); await click(zh.resultExport.chooseFile); expect(button(zh.resultExport.start).disabled).toBe(true); await input(text.confirmation, 'db.t '); expect(button(zh.resultExport.start).disabled).toBe(true); expect(await readFile(path, 'utf8')).toBe('原目标');
  });
  it.each(['mapping', 'format', 'encoding'] as const)('%s变化撤销旧预览和文件；旧闭包及恢复原值均不能复活', async mode => {
    await mount(); await target(); await ready(); const oldApply = callback(button(zh.resultExport.start)), oldChoose = callback(button('结果.sql')), oldRequest = requests.find(value => value.command === 'files.previewResultSql')!;
    if (mode === 'mapping') { await input(text.column(2), 'other'); await input(text.column(2), 'b'); }
    if (mode === 'format') { await select(zh.resultExport.format, 'csv'); await select(zh.resultExport.format, 'sql'); }
    if (mode === 'encoding') { await select(zh.resultExport.encoding, 'utf16le'); await select(zh.resultExport.encoding, 'utf8'); }
    await act(async () => { oldApply(); oldChoose(); }); expect(requests.filter(value => value.command === 'files.exportResult')).toHaveLength(0); expect(main.files.size).toBe(0); expect(document.querySelector(`pre[aria-label="${text.preview}"]`)).toBeNull();
    await expect(main.invoke('files.choose', { purpose: 'export', format: 'sql', resultSqlPreviewId: oldRequest.result.previewId })).rejects.toThrow('失效'); expect(await readFile(path, 'utf8')).toBe('原目标');
    await ready(); await act(async () => { callback(button(zh.resultExport.start))(); await Promise.all(writes); }); expect(requests.filter(value => value.command === 'files.exportResult')).toHaveLength(1);
  });
  it.each(['files.previewResultSql', 'files.choose'])('%s迟到返回不能认领已变化映射，能力与文件选择精确回收', async command => {
    await mount(); await target(); if (command === 'files.choose') await click(text.preview); const delayed = delay(command);
    await click(command === 'files.choose' ? zh.resultExport.chooseFile : text.preview); await input(text.column(2), 'later');
    await act(async () => { delayed.release(); }); hold = undefined;
    expect(document.querySelector(`pre[aria-label="${text.preview}"]`)).toBeNull(); expect(main.files.size).toBe(0); expect(requests.some(value => value.command === 'files.exportResult')).toBe(false); expect(await readFile(path, 'utf8')).toBe('原目标');
  });
  it('StrictMode仍能正常准备，关闭后旧回调不发布预览或写入文件', async () => {
    await mount(false, true); await target(); await ready(); const oldApply = callback(button(zh.resultExport.start)); await click(zh.common.close); expect(closed).toHaveBeenCalledOnce(); await act(async () => oldApply()); expect(requests.some(value => value.command === 'files.exportResult')).toBe(false); expect(main.files.size).toBe(0);
  });
  it('写任务回包等待中禁用关闭和配置，旧修改回调不能越过同步busy保护', async () => {
    await mount(); await target(); await ready();
    const oldChange = callback(document.querySelector(`input[aria-label="${text.column(2)}"]`), 'onChange'), delayed = delay('files.exportResult');
    await click(zh.resultExport.start); expect(button(zh.common.close).disabled).toBe(true);
    await act(async () => oldChange({ target: { value: '误改' } })); expect(document.querySelector(`input[aria-label="${text.column(2)}"]`)!.value).toBe('b');
    await act(async () => { delayed.release(); await Promise.all(writes); }); hold = undefined;
    expect(requests.filter(value => value.command === 'files.exportResult')).toHaveLength(1); expect(await readFile(path, 'utf8')).toContain('(`n`, `b`)'); expect(closed).not.toHaveBeenCalled();
  });
});
