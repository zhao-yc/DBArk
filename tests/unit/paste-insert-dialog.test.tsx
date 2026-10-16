import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { renderToStaticMarkup } from 'react-dom/server';
import * as jsxRuntime from 'react/jsx-runtime';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { PasteInsertDialog } from '../../src/renderer/components/PasteInsertDialog';
import * as logic from '../../src/renderer/pasteInsert';
import { pasteInsertZh as text } from '../../src/renderer/locales/pasteInsert.zh-CN';
import { cellClipboardType, encodeClipboard, maxClipboardCharacters } from '../../src/renderer/gridClipboard';
import { errorMessage } from '../../src/renderer/lib';
import type { TableInfo } from '../../src/shared/contracts';

const info: TableInfo = { database: 'db', name: 'items', objectKind: 'table', engine: 'InnoDB', ddl: '', primaryKey: ['id'], editableKey: ['id'], foreignKeys: [], indexes: [], columns: [
  { name: 'id', type: 'bigint', nullable: false, defaultValue: null, extra: 'auto_increment', generated: false, comment: '' },
  { name: 'note', type: 'text', nullable: true, defaultValue: null, extra: '', generated: false, comment: '' },
  { name: 'generated', type: 'text', nullable: true, defaultValue: null, extra: '', generated: true, comment: '' }
] };
type Element = { type: unknown; props: Record<string, any> };
/** 执行真实组件，只有React状态槽和Modal外壳为纯端口；事件是合成事件，不触碰系统剪贴板。 */
function component() {
  const slots: unknown[] = []; let cursor = 0;
  const hooks = {
    useState(initial: unknown) { const index = cursor++; if (!Object.hasOwn(slots, index)) slots[index] = initial; return [slots[index], (value: unknown) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }]; },
    useRef(initial: unknown) { const index = cursor++; if (!Object.hasOwn(slots, index)) slots[index] = { current: initial }; return slots[index]; }
  };
  const source = readFileSync(new URL('../../src/renderer/components/PasteInsertDialog.tsx', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} as { PasteInsertDialog: (props: unknown) => Element } };
  runInNewContext('(function(require,module,exports){' + code + '\n})')((name: string) => {
    if (name === 'react') return hooks; if (name === 'react/jsx-runtime') return jsxRuntime;
    if (name === '../pasteInsert') return logic; if (name === '../gridClipboard') return { maxClipboardCharacters };
    if (name === '../lib') return { errorMessage }; if (name === '../locales/pasteInsert.zh-CN') return { pasteInsertZh: text };
    if (name === './ui') return { Modal: 'modal-port', ErrorBox: 'error-port' }; throw Error('纯组件端口禁止未知依赖：' + name);
  }, module, module.exports);
  const props = { info, visibleKeys: ['id', 'note', 'generated'], invalidReason: '', onStage: vi.fn(), onClose: vi.fn() };
  let tree: Element;
  function render() { cursor = 0; tree = module.exports.PasteInsertDialog(props); return tree; }
  function all(type: string): Element[] {
    const found: Element[] = [];
    function walk(value: any) { if (Array.isArray(value)) value.forEach(walk); else if (value && typeof value === 'object' && value.props) { if (value.type === type) found.push(value); walk(value.props.children); } }
    walk(tree); return found;
  }
  function button(label: string) { const result = all('button').find(value => value.props.children === label); if (!result) throw Error('未找到按钮：' + label); return result; }
  render(); return { props, render, all, button, input: () => all('textarea')[0] };
}

describe('真实批量新增对话框的纯组件事件', () => {
  it('初次渲染没有读取/暂存，文案与入口明确为本地预览', () => {
    const stage = vi.fn(), html = renderToStaticMarkup(<PasteInsertDialog info={info} visibleKeys={['id', 'note']} invalidReason="" onStage={stage} onClose={() => undefined}/>);
    expect(html).toContain(text.hint); expect(html).toContain(text.stage); expect(html).toContain(text.limits); expect(stage).not.toHaveBeenCalled();
  });
  it('手工文本先预览再整批暂存，双击同一旧按钮只有一次回调', () => {
    const c = component(); c.input().props.onChange({ target: { value: '第一行\nNULL' } }); c.render(); c.button(text.preview).props.onClick(); c.render();
    expect(c.props.onStage).not.toHaveBeenCalled(); const stage = c.button(text.stage); expect(stage.props.disabled).toBe(false); stage.props.onClick(); stage.props.onClick();
    expect(c.props.onStage).toHaveBeenCalledTimes(1); const plan = c.props.onStage.mock.calls[0][0]; expect(plan.data.map((row: any) => row.note)).toEqual(['第一行', 'NULL']); expect(Object.hasOwn(plan.data[0], 'id')).toBe(false);
  });
  it('合成typed事件不降级，读取同一次plain仅一次，预览后改输入立即撤销旧Apply', () => {
    const c = component(), encoded = encodeClipboard([[null], [undefined]]), getData = vi.fn((type: string) => type === cellClipboardType ? encoded.typed : encoded.text), preventDefault = vi.fn();
    c.input().props.onPaste({ preventDefault, clipboardData: { types: [cellClipboardType, 'text/plain'], getData } }); c.render(); c.button(text.preview).props.onClick(); c.render();
    expect(preventDefault).toHaveBeenCalledOnce(); expect(getData).toHaveBeenCalledTimes(2); const oldStage = c.button(text.stage);
    c.input().props.onChange({ target: { value: '修改后正文' } }); oldStage.props.onClick(); expect(c.props.onStage).not.toHaveBeenCalled();
  });
  it('无效typed事件清掉旧计划，不偷偷用plain或旧输入暂存', () => {
    const c = component(); c.input().props.onChange({ target: { value: '旧值' } }); c.render(); c.button(text.preview).props.onClick(); c.render(); const oldStage = c.button(text.stage);
    c.input().props.onPaste({ preventDefault() {}, clipboardData: { types: [cellClipboardType], getData: (type: string) => type === cellClipboardType ? '{"version":999,"rows":[]}' : '不应暂存' } });
    oldStage.props.onClick(); c.render(); expect(c.props.onStage).not.toHaveBeenCalled(); expect(c.button(text.stage).props.disabled).toBe(true);
  });
  it('明确映射自增、重复映射和目标拒绝均在预览/回调安全处理', () => {
    const c = component(); c.input().props.onChange({ target: { value: '77' } }); c.render(); c.button(text.preview).props.onClick(); c.render();
    c.all('select')[0].props.onChange({ target: { value: '1' } }); c.render(); c.button(text.preview).props.onClick(); c.render();
    c.props.onStage.mockImplementation(() => { throw Error(text.changed); }); c.button(text.stage).props.onClick(); c.render();
    expect(c.props.onStage.mock.calls[0][0].data[0]).toEqual({ id: '77' }); expect(c.all('error-port')[0].props.message).toBe(text.changed); expect(c.button(text.stage).props.disabled).toBe(true);
  });
  it('1000行预览最多10行、目标改变禁用、关闭后的旧Apply不能复活', () => {
    const c = component(); c.input().props.onChange({ target: { value: Array(1000).fill('x').join('\n') } }); c.render(); c.button(text.preview).props.onClick(); c.render();
    expect(c.all('tbody')[0].props.children).toHaveLength(10); const stale = c.button(text.stage);
    c.props.invalidReason = text.changed; c.render(); expect(c.button(text.stage).props.disabled).toBe(true);
    stale.props.onClick(); expect(c.props.onStage).not.toHaveBeenCalled();
    c.button(text.close).props.onClick(); stale.props.onClick(); expect(c.props.onStage).not.toHaveBeenCalled(); expect(c.props.onClose).toHaveBeenCalledTimes(1);
  });
});
