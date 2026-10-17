import { act, useState } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { memoryDocument, MemoryEvent, type MemoryNode } from '../fixtures/memory-dom';
import type { SchemaCompareResultsProps } from '../../src/renderer/components/SchemaCompareResults';
import { SchemaCompareResults } from '../../src/renderer/components/SchemaCompareResults';
import { SchemaCompareDialog } from '../../src/renderer/components/SchemaCompareDialog';
import { schemaCompareResultsZh as text } from '../../src/renderer/locales/schemaCompareResults.zh-CN';
import { schemaCompareZh as labels } from '../../src/renderer/locales/schemaCompare.zh-CN';
import { applySchemaCompareResultsSelection, schemaCompareResultsId as id } from '../../src/renderer/schemaCompareResults';
import { schemaCompareResultsFixture } from './schemaCompareResults.fixtures';

// 包装只记录正式组件端口供迟到回调对照；真实组件、父窗口和 ReactDOM 均不替换。
const captured = vi.hoisted(() => ({ props: [] as SchemaCompareResultsProps[] }));
vi.mock('../../src/renderer/components/SchemaCompareResults', async original => {
  const actual = await original<typeof import('../../src/renderer/components/SchemaCompareResults')>();
  return { ...actual, SchemaCompareResults: (props: SchemaCompareResultsProps) => { captured.props.push(props); return <actual.SchemaCompareResults {...props}/>; } };
});
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;

beforeAll(async () => {
  document = memoryDocument(); Object.assign(document, { oninput: null });
  const create = document.createElement.bind(document);
  // 仅补齐受控 select 的内存属性，不模拟浏览器布局或原生 GUI。
  document.createElement = name => {
    const node = create(name);
    if (name === 'textarea') Object.defineProperty(node, 'defaultValue', { configurable: true, get: () => node.textContent, set: value => { node.textContent = value; } });
    if (name === 'option') Object.defineProperty(node, 'value', { configurable: true, get: () => node.attributes.get('value') ?? node.textContent, set: value => node.attributes.set('value', value) });
    if (name === 'select') {
      Object.defineProperty(node, 'options', { get: () => node.querySelectorAll('option') });
      Object.defineProperty(node, 'value', { configurable: true, get: () => node.querySelectorAll('option').find(option => (option as MemoryNode & { selected?: boolean }).selected)?.value ?? '', set: value => { for (const option of node.querySelectorAll('option')) (option as MemoryNode & { selected?: boolean }).selected = option.value === value; } });
    }
    const set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node);
    node.setAttribute = (key, value) => { set(key, value); if (key === 'disabled') node.disabled = true; };
    node.removeAttribute = key => { remove(key); if (key === 'disabled') node.disabled = false; };
    return node;
  };
  ({ createRoot } = await import('react-dom/client'));
});
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined; } document.body.textContent = ''; captured.props.length = 0; });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });

/** 定位及事件交给真实 ReactDOM；不读取 React 私有实例或复制组件状态机。 */
function byLabel(label: string): MemoryNode { const node = document.body.querySelectorAll('[aria-label]').find(item => item.getAttribute('aria-label') === label); if (!node) throw Error(`未找到标签：${label}`); return node; }
function button(label: string): MemoryNode { const node = document.body.querySelectorAll('button').find(item => item.textContent === label); if (!node) throw Error(`未找到按钮：${label}`); return node; }
async function click(node: MemoryNode) { await act(async () => { node.dispatchEvent(new MemoryEvent('click')); }); }
async function check(label: string, checked: boolean) { await act(async () => { const node = byLabel(label); node.checked = checked; node.dispatchEvent(new MemoryEvent('click')); }); }
async function input(label: string, value: string) { await act(async () => { const node = byLabel(label); node.value = value; node.dispatchEvent(new MemoryEvent(node.tagName === 'SELECT' ? 'change' : 'input')); }); }
async function mount(element: React.ReactNode) { const container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container as unknown as Element); await act(async () => root!.render(element)); }
function reportRows() { return document.body.querySelectorAll('tr[data-status]'); }
function Harness({ selected = [] as string[] }) {
  const report = schemaCompareResultsFixture(); const [selection, setSelection] = useState(selected);
  return <SchemaCompareResults report={report} selectedIds={selection} disabled={false} onSelectionChange={event => setSelection(previous => applySchemaCompareResultsSelection(report, previous, event))}/>;
}

describe('正式结构比较结果组件（内存 ReactDOM）', () => {
  it('组合筛选、当前总数和空结果提示可操作，重置恢复默认而非改动选择', async () => {
    await mount(<Harness/>); expect(reportRows()).toHaveLength(5); expect(document.body.textContent).toContain(text.count(5, 6));
    await input(text.category, 'columns'); await input(text.status, 'changed'); await input(text.name, 'nUlL');
    expect(reportRows()).toHaveLength(1); expect(reportRows()[0].textContent).toContain('"NULL"'); expect(document.body.textContent).toContain(text.count(1, 6));
    await input(text.name, '不存在'); expect(reportRows()).toHaveLength(0); expect(document.body.textContent).toContain(text.noMatch);
    await click(button(text.reset)); expect(reportRows()).toHaveLength(5);
    await input(text.status, 'same'); expect(reportRows()).toHaveLength(1); expect(byLabel('选择 字段 same').disabled).toBe(true);
  });
  it('过滤只隐藏选择，明显显示隐藏数量；明确清除只移除隐藏项', async () => {
    const report = schemaCompareResultsFixture(); await mount(<Harness selected={[id(report.rows[0]), id(report.rows[1])]}/>);
    await input(text.category, 'columns'); expect(document.body.textContent).toContain(text.hidden(1)); expect(byLabel('选择 字段 NULL').checked).toBe(true);
    expect(captured.props.at(-1)!.selectedIds).toEqual([id(report.rows[0]), id(report.rows[1])]);
    await click(button(text.clearHidden)); expect(document.body.textContent).not.toContain(text.hidden(1)); expect(byLabel('选择 字段 NULL').checked).toBe(true);
    await input(text.category, 'all'); expect(byLabel('选择 主键 / 索引 ix.Mixed').checked).toBe(false); expect(byLabel('选择 字段 NULL').checked).toBe(true);
  });
  it('真实复选框事件向父级提交当前快照的增量选择，取消勾选可恢复', async () => {
    await mount(<Harness/>); const report = schemaCompareResultsFixture();
    await check('选择 字段 NULL', true); expect(captured.props.at(-1)!.selectedIds).toEqual([id(report.rows[0])]);
    await check('选择 主键 / 索引 ix.Mixed', true); expect(captured.props.at(-1)!.selectedIds).toEqual([id(report.rows[0]), id(report.rows[1])]);
    await check('选择 字段 NULL', false); expect(captured.props.at(-1)!.selectedIds).toEqual([id(report.rows[1])]);
  });
  it('特殊名称与不可比较原因始终是文本，原定义按需展开并区分 NULL 与缺失侧', async () => {
    await mount(<Harness/>); expect(document.body.querySelectorAll('pre')).toHaveLength(0);
    expect(byLabel('选择 其它约束 未知约束').disabled).toBe(true); expect(document.body.textContent).toContain('无法识别的约束：<img src=x>');
    await input(text.name, '.*"`<img>'); expect(reportRows()).toHaveLength(1); expect(document.body.textContent).toContain('注释、unknownProperty');
    await click(button(text.expand)); expect(document.body.textContent).toContain('<script>alert("仅文本")</script>'); expect(document.body.querySelectorAll('script,img')).toHaveLength(0);
    await click(button(text.collapse)); expect(document.body.querySelectorAll('pre')).toHaveLength(0);
    await input(text.name, 'NULL'); await click(button(text.expand)); expect(document.body.textContent).toContain('DEFAULT NULL'); expect(document.body.textContent).toContain("DEFAULT 'NULL'");
    await input(text.name, 'ix.Mixed'); await click(button(text.expand)); expect(document.body.textContent).toContain(labels.absent);
  });
  it('纯文本静态输出不会解释特殊标识符或原因，未展开时不挂载原 SQL', () => {
    const html = renderToStaticMarkup(<SchemaCompareResults report={schemaCompareResultsFixture()} selectedIds={[]} disabled={false} onSelectionChange={() => undefined}/>);
    expect(html).toContain('&lt;img'); expect(html).not.toContain('<img>'); expect(html).not.toContain('<script>'); expect(html).not.toContain('alert(');
  });
  it('禁选状态不接受选择和清除，空报告明确说明范围', async () => {
    const report = schemaCompareResultsFixture(), changed = vi.fn();
    await mount(<SchemaCompareResults report={report} selectedIds={[id(report.rows[1])]} disabled onSelectionChange={changed}/>);
    await input(text.category, 'columns'); expect(button(text.clearHidden).disabled).toBe(true); expect(byLabel('选择 字段 NULL').disabled).toBe(true);
    await click(button(text.clearHidden)); expect(changed).not.toHaveBeenCalled();
    await act(async () => root!.render(<SchemaCompareResults report={{ ...report, snapshotId: '空报告', rows: [] }} selectedIds={[]} disabled={false} onSelectionChange={changed}/>));
    expect(document.body.textContent).toContain(text.noRows); expect(document.body.textContent).toContain(text.count(0, 0));
  });
});

describe('正式父窗口快照接纳与预览', () => {
  async function setup() {
    const a = schemaCompareResultsFixture('快照甲'), b = schemaCompareResultsFixture('快照乙');
    const services = { compare: vi.fn().mockResolvedValueOnce(a).mockResolvedValueOnce(b), cancel: vi.fn(), release: vi.fn().mockResolvedValue(undefined), save: vi.fn().mockResolvedValue(true),
      preview: vi.fn().mockResolvedValue({ direction: 'source-to-target', target: a.target, expiresAt: a.expiresAt, sql: '仅内存 SQL 审查稿', statements: [{ category: 'columns', name: 'NULL', sql: '仅内存 SQL', destructive: false }], blocked: [], warnings: [], executable: false }) };
    await mount(<SchemaCompareDialog connections={[{ id: 'a', name: '甲' }, { id: 'b', name: '乙' }]} services={services} initialSource={a.source} initialTarget={a.target} onClose={() => undefined}/>);
    await click(button(labels.start)); return { a, b, services };
  }
  it('隐藏已选仍进入正式预览，清除后撤销旧审查稿并仅预览保留项', async () => {
    const { a, services } = await setup();
    await act(async () => captured.props.at(-1)!.onSelectionChange({ snapshotId: a.snapshotId, kind: 'toggle', id: id(a.rows[0]), checked: true }));
    await act(async () => captured.props.at(-1)!.onSelectionChange({ snapshotId: a.snapshotId, kind: 'toggle', id: id(a.rows[1]), checked: true }));
    await input(text.category, 'columns'); await click(button(labels.preview));
    expect(services.preview).toHaveBeenLastCalledWith({ snapshotId: a.snapshotId, selections: [{ category: 'columns', name: 'NULL' }, { category: 'indexes', name: 'ix.Mixed' }] });
    expect(byLabel(labels.sql).value).toBe('仅内存 SQL 审查稿'); await click(button(text.clearHidden));
    expect(document.body.querySelectorAll('textarea')).toHaveLength(0); await click(button(labels.preview));
    expect(services.preview).toHaveBeenLastCalledWith({ snapshotId: a.snapshotId, selections: [{ category: 'columns', name: 'NULL' }] });
  });
  it('旧报告选择及旧筛选清除回调不能借新报告改选择或清除新预览', async () => {
    const { a, b, services } = await setup(), old = captured.props.at(-1)!;
    await input(text.category, 'indexes'); await click(button(labels.start));
    expect(byLabel(text.category).value).toBe('all');
    await act(async () => captured.props.at(-1)!.onSelectionChange({ snapshotId: b.snapshotId, kind: 'toggle', id: id(b.rows[0]), checked: true }));
    await click(button(labels.preview)); await click(button(labels.save)); expect(document.body.textContent).toContain(labels.saved);
    await act(async () => {
      old.onSelectionChange({ snapshotId: a.snapshotId, kind: 'toggle', id: id(a.rows[1]), checked: true });
      old.onSelectionChange({ snapshotId: a.snapshotId, kind: 'clearHidden', ids: [id(a.rows[0])] });
      old.onSelectionChange({ snapshotId: b.snapshotId, kind: 'clearHidden', ids: [id(b.rows[0])] });
    });
    expect(captured.props.at(-1)!.selectedIds).toEqual([id(b.rows[0])]); expect(byLabel(labels.sql).value).toBe('仅内存 SQL 审查稿'); expect(document.body.textContent).toContain(labels.saved);
    await click(button(labels.preview)); expect(services.preview).toHaveBeenLastCalledWith({ snapshotId: b.snapshotId, selections: [{ category: 'columns', name: 'NULL' }] });
  });
});
