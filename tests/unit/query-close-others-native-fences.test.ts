import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../e2e/query-close-others-native.spec.ts', import.meta.url), 'utf8');
/** 抽取spec准确函数，不导入桌面、不调用任何产品handler。 */
function method(name: string): string {
  const tree = ts.createSourceFile('native-spec.ts', source, ts.ScriptTarget.Latest, true);
  const node = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  if (!node) throw Error('缺少spec函数：' + name);
  return ts.transpileModule(node.getText(tree), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}

/** 仅提供观察器所需DOM只读端口；契约反例不冒充Chromium或真实GUI可达。 */
class RamElement {
  readonly nodeType = 1; children: RamElement[] = []; parentElement: RamElement | null = null;
  constructor(readonly tag: string, readonly attributes: Record<string, string> = {}, public text = '') {}
  get textContent(): string { return this.text + this.children.map(child => child.textContent).join(''); }
  getAttribute(name: string): string | null { return this.attributes[name] ?? null; }
  matches(selector: string): boolean { return selector === '[role="dialog"]' ? this.attributes.role === 'dialog' : selector === this.tag; }
  querySelectorAll(selector: string): RamElement[] { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector: string): RamElement | null { return this.querySelectorAll(selector)[0] ?? null; }
  append(child: RamElement): void { child.parentElement = this; this.children.push(child); }
  remove(child: RamElement): void { this.children = this.children.filter(node => node !== child); child.parentElement = null; }
}
const targets = [{ id: 'owned-a', title: '本例A' }, { id: 'owned-b', title: '本例B' }, { id: 'owned-c', title: '本例C' }];
/** 保存准确原MutationRecord批次；回调时当前DOM允许已经没有该弹窗。 */
async function observation() {
  const body = new RamElement('body'), window: Record<string, any> = {};
  let callback!: (records: unknown[]) => void, pending: unknown[] = [], disconnected = false;
  const observer = { observe(target: unknown) { expect(target).toBe(body); }, disconnect() { disconnected = true; }, takeRecords() { const records = pending; pending = []; return records; } };
  const context = { window, document: { body, querySelectorAll: (selector: string) => body.querySelectorAll(selector) }, MutationObserver: class { constructor(fn: typeof callback) { callback = fn; return observer; } }, close: { title: '关闭查询' }, desktop: () => ({ page: { evaluate: async (fn: (input: unknown) => unknown, input: unknown) => fn(input) } }), info: { testId: '本例owner', retry: 0 }, targets };
  await runInNewContext(method('observeCloseDialogs') + '\nobserveCloseDialogs(info, targets);', context);
  return { body, result: () => window.__closeOthersObservation, emit: (records: unknown[]) => callback(records), queue: (records: unknown[]) => { pending.push(...records); }, disconnected: () => disconnected };
}
/** 生成真实结构形状的关闭dialog；标题和strong是原组件的可见归属见证。 */
function dialog(title: string, label = '关闭查询') {
  const node = new RamElement('div', { role: 'dialog', 'aria-label': label }); node.append(new RamElement('strong', {}, title)); return node;
}

describe('关闭其他查询原生spec新增准备门与观察契约（仅RAM）', () => {
  it('原红一：显式DEV_URL含空值必须拒绝', () => {
    for (const value of ['', 'http://非本例renderer.invalid/']) {
      expect(() => runInNewContext(method('assertOfflineCloseOthersEnvironment') + '\nassertOfflineCloseOthersEnvironment(env,[]);', { env: { DBARK_INTEGRATION_ENABLED: '0', DBARK_DEV_URL: value } })).toThrow('DBARK_DEV_URL');
    }
  });
  it('原红二：同批插入再移除B的dialog，应读取addedNodes及子树而非只采当前DOM', async () => {
    const f = await observation(), wrapper = new RamElement('section'); wrapper.append(dialog(targets[1].title));
    f.body.append(wrapper); f.body.remove(wrapper); expect(f.body.querySelectorAll('[role="dialog"]')).toEqual([]);
    f.emit([{ type: 'childList', target: f.body, addedNodes: [wrapper] }]);
    expect(f.result().seen).toContain(targets[1].title);
  });
  it('必要对照：DEV_URL自有undefined同样拒绝，未设置及准确EXE别名保持准入', () => {
    const call = (env: Record<string, unknown>) => runInNewContext(method('assertOfflineCloseOthersEnvironment') + '\nassertOfflineCloseOthersEnvironment(env,[]);', { env });
    expect(() => call({ DBARK_INTEGRATION_ENABLED: '0', DBARK_DEV_URL: undefined })).toThrow('DBARK_DEV_URL');
    expect(() => call({ DBARK_INTEGRATION_ENABLED: '0' })).not.toThrow();
    expect(() => call({ DBARK_INTEGRATION_ENABLED: '0', DBARK_EXECUTABLE_PATH: '准确EXE', DBARK_C02_EXECUTABLE_PATH: '准确EXE' })).not.toThrow();
  });
  it('必要对照：直接插入的B准确映射本例目标，文本节点忽略，停止前收集未交付记录', async () => {
    const f = await observation(), b = dialog(targets[1].title), c = dialog(targets[2].title);
    f.emit([{ addedNodes: [{ nodeType: 3 }, b] }]);
    expect(f.result().runId).toBe('本例owner:0'); expect(f.result().targets).toEqual(targets);
    expect(f.result().matches).toEqual([{ tabId: targets[1].id, title: targets[1].title }]);
    f.queue([{ addedNodes: [c] }]); f.result().stop(); expect(f.disconnected()).toBe(true);
    expect(f.result().seen).toEqual([targets[1].title, targets[2].title]);
  });
  it('必要对照：无关dialog不冒充关闭见证，同名未知目标明确未归属', async () => {
    const f = await observation();
    f.emit([{ addedNodes: [dialog(targets[1].title, '别的对话框')] }]); expect(f.result().seen).toEqual([]);
    f.emit([{ addedNodes: [dialog('其它任务的B')] }]); expect(f.result().matches).toEqual([{ tabId: null, title: '其它任务的B' }]);
  });
  it('必要对照：当前DOM重采不重复记录，但同一dialog改成B仍可观察', async () => {
    const f = await observation(), a = dialog(targets[0].title); f.body.append(a);
    f.emit([{ addedNodes: [a] }]); f.emit([]); expect(f.result().seen).toEqual([targets[0].title]);
    a.querySelector('strong')!.text = targets[1].title; f.emit([]);
    expect(f.result().seen).toEqual([targets[0].title, targets[1].title]);
    expect(f.result().matches[1]).toEqual({ tabId: targets[1].id, title: targets[1].title });
  });
});
