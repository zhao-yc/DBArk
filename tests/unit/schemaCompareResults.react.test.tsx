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
import type { SchemaComparePreviewInput } from '../../src/shared/schemaCompare';

// 包装只记录正式组件端口供迟到回调对照；真实组件、父窗口和 ReactDOM 均不替换。
const captured = vi.hoisted(() => ({ props: [] as SchemaCompareResultsProps[], actions: [] as { preview?: () => void; save?: () => void; close?: () => void }[] }));
vi.mock('../../src/renderer/components/SchemaCompareResults', async original => {
  const actual = await original<typeof import('../../src/renderer/components/SchemaCompareResults')>();
  return { ...actual, SchemaCompareResults: (props: SchemaCompareResultsProps) => { captured.props.push(props); return <actual.SchemaCompareResults {...props}/>; } };
});
vi.mock('../../src/renderer/components/ui', async original => {
  const actual = await original<typeof import('../../src/renderer/components/ui')>();
  const { Children, isValidElement } = await import('react');
  return { ...actual, Modal: (props: React.ComponentProps<typeof actual.Modal>) => {
    const actions: { preview?: () => void; save?: () => void; close?: () => void } = {};
    // 仅捕获正式父窗口交给 Modal 的按钮回调；仍渲染原 Modal，不读取 React 私有字段。
    function visit(nodes: React.ReactNode): void {
      Children.forEach(nodes, child => { if (isValidElement<{ children?: React.ReactNode; onClick?: () => void }>(child)) {
        if (child.type === 'button' && child.props.children === labels.preview) actions.preview = child.props.onClick;
        if (child.type === 'button' && child.props.children === labels.save) actions.save = child.props.onClick;
        if (child.type === 'button' && child.props.children === labels.close) actions.close = child.props.onClick;
        visit(child.props.children);
      } });
    }
    visit(props.children); captured.actions.push(actions); return <actual.Modal {...props}/>;
  } };
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
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined; } document.body.textContent = ''; captured.props.length = 0; captured.actions.length = 0; });
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
    const closed = vi.fn();
    await mount(<SchemaCompareDialog connections={[{ id: 'a', name: '甲' }, { id: 'b', name: '乙' }]} services={services} initialSource={a.source} initialTarget={a.target} onClose={closed}/>);
    await click(button(labels.start)); return { a, b, services, closed };
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
  it('同步围栏：预览首等待前拒绝选择及重复请求，完成后允许正常选择', async () => {
    const { a, services } = await setup(); await check('选择 字段 NULL', true);
    const before = captured.props.at(-1)!, actions = captured.actions.at(-1)!;
    let finish!: () => void, requested!: SchemaComparePreviewInput;
    const waiting = new Promise<void>(resolve => { finish = resolve; });
    services.preview.mockImplementationOnce(async input => {
      requested = input; before.onSelectionChange({ snapshotId: a.snapshotId, kind: 'toggle', id: id(a.rows[1]), checked: true });
      actions.preview!(); await waiting;
      return { target: a.target, sql: '只含 NULL 的固定稿', statements: [{}], warnings: [], blocked: [] };
    });
    await click(button(labels.preview)); expect(captured.props.at(-1)!.selectedIds).toEqual([id(a.rows[0])]); expect(services.preview).toHaveBeenCalledTimes(1);
    expect(requested.selections).toEqual([{ category: 'columns', name: 'NULL' }]);
    await act(async () => finish()); expect(captured.props.at(-1)!.selectedIds).toEqual([id(a.rows[0])]); expect(byLabel(labels.sql).value).toBe('只含 NULL 的固定稿');
    await check('选择 主键 / 索引 ix.Mixed', true); expect(captured.props.at(-1)!.selectedIds).toEqual([id(a.rows[0]), id(a.rows[1])]); expect(document.body.querySelectorAll('textarea')).toHaveLength(0);
  });
  it.each(['成功', '取消', '失败'])('同步围栏：保存%s时首等待前不改选择，终态释放当前 owner', async outcome => {
    const { a, services } = await setup(); await check('选择 字段 NULL', true); await click(button(labels.preview));
    const before = captured.props.at(-1)!, actions = captured.actions.at(-1)!;
    let finish!: () => void; const waiting = new Promise<void>(resolve => { finish = resolve; });
    services.save.mockImplementationOnce(async sql => {
      expect(sql).toBe('仅内存 SQL 审查稿'); before.onSelectionChange({ snapshotId: a.snapshotId, kind: 'clearHidden', ids: [id(a.rows[0])] });
      actions.save!(); await waiting; if (outcome === '失败') throw Error('合成保存失败'); return outcome === '成功';
    });
    await click(button(labels.save)); expect(captured.props.at(-1)!.selectedIds).toEqual([id(a.rows[0])]); expect(services.save).toHaveBeenCalledTimes(1);
    await act(async () => finish()); expect(byLabel(labels.sql).value).toBe('仅内存 SQL 审查稿');
    expect(document.body.textContent.includes(labels.saved)).toBe(outcome === '成功'); if (outcome === '失败') expect(document.body.textContent).toContain('合成保存失败');
    await check('选择 主键 / 索引 ix.Mixed', true); expect(captured.props.at(-1)!.selectedIds).toEqual([id(a.rows[0]), id(a.rows[1])]);
  });
  it.each(['同步抛错', '过期拒绝'])('同步围栏：预览%s后正常释放并可重新预览', async outcome => {
    const { a, services } = await setup(); await check('选择 字段 NULL', true); const before = captured.props.at(-1)!;
    services.preview.mockImplementationOnce(() => {
      before.onSelectionChange({ snapshotId: a.snapshotId, kind: 'toggle', id: id(a.rows[1]), checked: true });
      if (outcome === '同步抛错') throw Error(outcome); return Promise.reject(Error(outcome));
    });
    await click(button(labels.preview)); expect(captured.props.at(-1)!.selectedIds).toEqual([id(a.rows[0])]); expect(document.body.textContent).toContain(outcome);
    await check('选择 主键 / 索引 ix.Mixed', true); await click(button(labels.preview)); expect(services.preview).toHaveBeenCalledTimes(2);
    expect(services.preview).toHaveBeenLastCalledWith({ snapshotId: a.snapshotId, selections: [{ category: 'columns', name: 'NULL' }, { category: 'indexes', name: 'ix.Mixed' }] });
  });
  it('同步围栏：旧渲染及旧快照的预览/保存 handler 不能重新领取 owner', async () => {
    const { services } = await setup(); await check('选择 字段 NULL', true); const oldPreview = captured.actions.at(-1)!.preview!;
    await click(button(labels.preview)); const oldSave = captured.actions.at(-1)!.save!;
    await check('选择 主键 / 索引 ix.Mixed', true);
    await act(async () => { oldPreview(); oldSave(); }); expect(services.preview).toHaveBeenCalledTimes(1); expect(services.save).not.toHaveBeenCalled(); expect(document.body.querySelectorAll('textarea')).toHaveLength(0);
    await click(button(labels.start)); await check('选择 字段 NULL', true);
    await act(async () => { oldPreview(); oldSave(); }); expect(services.preview).toHaveBeenCalledTimes(1); expect(services.save).not.toHaveBeenCalled();
    await click(button(labels.preview)); expect(services.preview).toHaveBeenCalledTimes(2);
  });
  it('权威选择：同一渲染内清除隐藏项再连续选择，预览活读全部已接纳意图', async () => {
    const { a, services } = await setup(); await check('选择 字段 NULL', true); await check('选择 主键 / 索引 ix.Mixed', true);
    await input(text.category, 'columns'); const before = captured.props.at(-1)!, actions = captured.actions.at(-1)!;
    await act(async () => {
      before.onSelectionChange({ snapshotId: a.snapshotId, kind: 'clearHidden', ids: [id(a.rows[1])] });
      before.onSelectionChange({ snapshotId: a.snapshotId, kind: 'toggle', id: id(a.rows[2]), checked: true });
      actions.preview!();
    });
    expect(captured.props.at(-1)!.selectedIds).toEqual([id(a.rows[0]), id(a.rows[2])]);
    expect(services.preview).toHaveBeenLastCalledWith({ snapshotId: a.snapshotId, selections: [{ category: 'columns', name: 'NULL' }, { category: 'foreignKeys', name: 'fk' }] });
    expect(byLabel(labels.sql).value).toBe('仅内存 SQL 审查稿');
  });
  it('权威选择：选择先接纳会同步撤销旧稿，原渲染保存 handler 不能保存失效稿', async () => {
    const { a, services } = await setup(); await check('选择 字段 NULL', true); await click(button(labels.preview));
    const before = captured.props.at(-1)!, actions = captured.actions.at(-1)!;
    await act(async () => {
      before.onSelectionChange({ snapshotId: a.snapshotId, kind: 'toggle', id: id(a.rows[1]), checked: true });
      actions.save!();
    });
    expect(services.save).not.toHaveBeenCalled(); expect(captured.props.at(-1)!.selectedIds).toEqual([id(a.rows[0]), id(a.rows[1])]); expect(document.body.querySelectorAll('textarea')).toHaveLength(0);
    await click(button(labels.preview)); await click(button(labels.save)); expect(services.save).toHaveBeenCalledTimes(1); expect(document.body.textContent).toContain(labels.saved);
  });
  it('权威选择：关闭等待原预览 owner，终态不接纳旧稿或让旧回调重新领取', async () => {
    const { a, services, closed } = await setup(); await check('选择 字段 NULL', true);
    const before = captured.props.at(-1)!, actions = captured.actions.at(-1)!; let finish!: () => void;
    const waiting = new Promise<void>(resolve => { finish = resolve; });
    services.preview.mockImplementationOnce(async () => { await waiting; return { sql: '关闭后不可显示', statements: [{}], warnings: [], blocked: [] }; });
    await click(button(labels.preview)); await click(button(labels.close)); expect(closed).not.toHaveBeenCalled();
    await act(async () => { before.onSelectionChange({ snapshotId: a.snapshotId, kind: 'toggle', id: id(a.rows[1]), checked: true }); actions.preview!(); actions.save!(); actions.close!(); });
    expect(captured.props.at(-1)!.selectedIds).toEqual([id(a.rows[0])]); expect(services.preview).toHaveBeenCalledTimes(1);
    await act(async () => finish()); expect(closed).toHaveBeenCalledTimes(1); expect(services.release).toHaveBeenCalledWith(a.snapshotId); expect(document.body.querySelectorAll('textarea')).toHaveLength(0);
    await act(async () => { actions.preview!(); actions.save!(); actions.close!(); }); expect(closed).toHaveBeenCalledTimes(1); expect(services.preview).toHaveBeenCalledTimes(1); expect(services.save).not.toHaveBeenCalled();
  });
});
