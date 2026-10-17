import { act } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { memoryDocument, MemoryEvent, type MemoryNode } from '../fixtures/memory-dom';
import { zh } from '../../src/renderer/locales/zh-CN';
import { assertTlsPassphrase } from '../../src/shared/tlsCredentials';
import type { ConnectionProfile } from '../../src/shared/contracts';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../../src/renderer/lib', async original => ({ ...await original<object>(), invoke: request, uid: () => '仅RAM合成连接' }));
const cases = [
  { file: 'data-search.spec.ts', title: '真实列权限：不可读键仅降为只读命中，明确搜索不可读字段仍报错并可恢复' },
  { file: 'references.spec.ts', title: '父表权限不足时读取明确失败，可空复合外键仍可清空草稿并经预览提交' }
];
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let Component: typeof import('../../src/renderer/components/ConnectionDialog')['ConnectionDialog'], workspace: typeof import('../../src/renderer/store')['useWorkspace'];
const syntheticPassword = '仅用于内存回归的合成密码';

/** 从指定真实用例提取连续表单语句，绝不导入或执行实库fixture、DDL和清理。 */
function fixtureForm(file: string, title: string): string {
  const source = ts.createSourceFile(file, readFileSync(new URL(`../e2e/${file}`, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  let callback: ts.Node | undefined;
  const find = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'test' && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === title) callback = node.arguments[1];
    ts.forEachChild(node, find);
  };
  find(source); if (!callback) throw Error('缺少指定真实用例');
  const segments: string[] = [];
  const blocks = (node: ts.Node) => {
    if (ts.isBlock(node)) {
      const start = node.statements.findIndex(statement => /^await page\.locator\('\.app-commandbar'\).*新建连接/.test(statement.getText(source)));
      if (start >= 0) {
        const end = node.statements.findIndex((statement, index) => index > start && /await expect\(form\)\.(?:toHaveCount\(0\)|toBeHidden\(\))/.test(statement.getText(source)));
        if (end < 0) throw Error('真实表单缺少保存后关闭断言');
        segments.push(node.statements.slice(start, end + 1).map(statement => statement.getText(source)).join('\n'));
      }
    }
    ts.forEachChild(node, blocks);
  };
  blocks(callback); expect(segments).toHaveLength(1); return segments[0];
}

/** 编译生产存储方法；端口仅为Map，不加载SQLite、文件存储、Electron或系统加密器。 */
function ramStore() {
  const source = ts.createSourceFile('storage.ts', readFileSync(new URL('../../src/main/storage.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const names = ['readSecret', 'hasSecret', 'putSecret', 'connections', 'saveConnection'];
  const methods: string[] = [];
  const visit = (node: ts.Node) => { if (ts.isMethodDeclaration(node) && names.includes(node.name.getText(source))) methods.push(node.getText(source)); ts.forEachChild(node, visit); };
  visit(source); expect(methods).toHaveLength(names.length);
  const compiled = ts.transpile(`class RamStore { ${methods.join('\n')} }; RamStore`, { target: ts.ScriptTarget.ES2022 });
  const Store = runInNewContext(compiled, { structuredClone, assertTlsPassphrase, randomUUID: () => '仅RAM合成连接', tablePreferenceTargetChanged: () => { throw Error('本片不允许编辑既有连接'); } });
  const profiles = new Map<string, string>(), secrets = new Map<string, string>();
  const protector = { available: vi.fn(() => true), encrypt: vi.fn(() => '合成密文'), decrypt: vi.fn(() => syntheticPassword) };
  const store = new Store(); store.volatileSecrets = new Map<string, string>(); store.protector = protector; store.connectionRevisionValue = 0;
  store.mutate = (action: () => void) => action();
  store.records = (_sql: string, values?: string[]) => [...profiles].filter(([id]) => !values || id === values[0]).map(([, value]) => JSON.parse(value));
  store.db = {
    run: vi.fn((sql: string, values: string[]) => {
      if (sql.startsWith('DELETE FROM secrets')) secrets.delete(values[0] + '\0' + values[1]);
      else if (sql.startsWith('INSERT INTO secrets')) secrets.set(values[0] + '\0' + values[1], values[2]);
      else if (sql.startsWith('INSERT INTO connections')) profiles.set(values[0], values[1]);
      else throw Error('内存端口拒绝未知写入');
    }),
    prepare(sql: string) {
      if (!/^SELECT (?:value|1) FROM secrets/.test(sql)) throw Error('内存端口拒绝未知读取');
      let key = ''; return { bind(values: string[]) { key = values.join('\0'); }, step: () => secrets.has(key), get: () => [secrets.get(key)], free() {} };
    }
  };
  return { store: store as { saveConnection(input: ConnectionProfile): ConnectionProfile; connections(): ConnectionProfile[]; volatileSecrets: Map<string, string> }, profiles, secrets, protector };
}

beforeAll(async () => {
  document = memoryDocument(); (document as unknown as { oninput: null }).oninput = null; Object.assign(window, { setTimeout, clearTimeout });
  const create = document.createElement.bind(document);
  document.createElement = name => {
    const node = create(name);
    if (name === 'input') { let kind = 'text'; Object.defineProperty(node, 'type', { configurable: true, get: () => kind, set: value => { kind = value; node.attributes.set('type', value); } }); node.type = 'text'; }
    if (name === 'option') Object.defineProperty(node, 'value', { configurable: true, get: () => node.attributes.get('value') ?? node.textContent, set: value => node.attributes.set('value', value) });
    if (name === 'select') { Object.defineProperty(node, 'options', { get: () => node.querySelectorAll('option') }); Object.defineProperty(node, 'value', { configurable: true, get: () => node.querySelectorAll('option').find(option => (option as MemoryNode & { selected?: boolean }).selected)?.value ?? '', set: value => { for (const option of node.querySelectorAll('option')) (option as MemoryNode & { selected?: boolean }).selected = option.value === value; } }); }
    const set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node);
    node.setAttribute = (key, value) => { set(key.toLowerCase(), value); if (key === 'disabled') node.disabled = true; if (key === 'type') node.type = value; };
    node.removeAttribute = key => { remove(key.toLowerCase()); if (key === 'disabled') node.disabled = false; }; return node;
  };
  ({ createRoot } = await import('react-dom/client')); ({ ConnectionDialog: Component } = await import('../../src/renderer/components/ConnectionDialog')); ({ useWorkspace: workspace } = await import('../../src/renderer/store'));
});
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined; } request.mockReset(); });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });

/** 只实现这段fixture实际使用的定位操作；输入和复选框动作仍投递到真实ReactDOM。 */
function locator(resolve: () => MemoryNode | undefined) {
  const current = () => { const node = resolve(); if (!node) throw Error('内存表单找不到目标'); return node; };
  return {
    resolve,
    getByRole(role: string, options: { name: string }) {
      return locator(() => current().querySelectorAll(role === 'button' ? 'button' : 'input[type="checkbox"]').find(node => role === 'button' ? node.textContent === options.name : node.parentNode?.textContent === options.name));
    },
    getByLabel(name: string) {
      return locator(() => current().querySelectorAll('input').find(node => node.getAttribute('aria-label') === name || node.parentNode?.querySelector('span')?.textContent === name));
    },
    locator(selector: string) {
      if (selector !== '.success-box') throw Error('内存端口拒绝未知选择器');
      return locator(() => current().querySelectorAll('div').find(node => node.getAttribute('class') === 'success-box'));
    },
    async fill(value: string) { await act(async () => { const node = current(); node.value = value; node.dispatchEvent(new MemoryEvent('input')); }); },
    async uncheck() { await act(async () => { const node = current(); if (node.checked) { node.checked = false; node.dispatchEvent(new MemoryEvent('click')); } }); },
    async click() {
      await act(async () => {
        const node = current(); expect(node.disabled).toBe(false); node.dispatchEvent(new MemoryEvent('click'));
        // 内存DOM没有浏览器默认提交行为；补投submit事件，仍由真实表单onSubmit处理。
        if (node.type === 'submit' || node.getAttribute('type') === 'submit') { let form: MemoryNode | null = node; while (form && form.tagName !== 'FORM') form = form.parentNode; if (!form) throw Error('缺少真实表单'); form.dispatchEvent(new MemoryEvent('submit')); }
      });
    }
  };
}
type RamLocator = ReturnType<typeof locator>;
/** Playwright断言的内存适配只观察DOM，不修补待提交profile或rememberPassword。 */
function fixtureExpect(target: RamLocator) {
  return {
    not: { toBeChecked: async () => expect(target.resolve()?.checked).toBe(false) },
    toContainText: async (value: string) => expect(target.resolve()?.textContent).toContain(value),
    toHaveCount: async (count: number) => expect(target.resolve() ? 1 : 0).toBe(count),
    toBeHidden: async () => expect(target.resolve()).toBeUndefined()
  };
}

/** 请求只进入上述RAM存储端口；禁止任何未声明命令，也不会连接数据库。 */
async function mount() {
  const ram = ramStore(); request.mockClear(); request.mockImplementation(async (command: string, input: ConnectionProfile) => {
    if (command === 'connections.test') return { dialect: 'mysql', version: '合成版本' };
    if (command === 'connections.save') return ram.store.saveConnection(input);
    if (command === 'connections.list') return ram.store.connections();
    throw Error('本回归拒绝未声明命令：' + command);
  });
  workspace.setState({ connections: [], settings: { ...workspace.getState().settings, tabs: [] } });
  document.body.textContent = ''; const container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container as unknown as Element);
  await act(async () => root!.render(<Component onClose={() => root!.render(null)} onTransportChanged={() => { throw Error('新连接不应通知既有连接变更'); }}/>));
  return ram;
}

describe('两条限权真实fixture的临时密码仅RAM', () => {
  it.each(cases)('$file：原始表单语句关闭保存，测试与保存均仅RAM', async ({ file, title }) => {
    const ram = await mount();
    expect(document.querySelector('input[type="checkbox"]')?.checked).toBe(true);
    const form = locator(() => document.querySelectorAll('div[role="dialog"]').find(node => node.getAttribute('aria-label') === '新建连接'));
    const page = { locator: (selector: string) => { expect(selector).toBe('.app-commandbar'); return { getByRole: (_role: string, options: { name: string }) => ({ click: async () => { expect(options.name).toBe('新建连接'); } }) }; }, getByRole: () => form };
    const code = ts.transpile(`(async () => { ${fixtureForm(file, title)} })()`, { target: ts.ScriptTarget.ES2022 });
    await runInNewContext(code, { page, expect: fixtureExpect, zh, environment: { DBARK_TEST_HOST: 'ram.example.invalid', DBARK_TEST_PORT: '13384' }, port: 13384, user: '合成临时账号', password: syntheticPassword, connectionName: '合成限权连接' });
    const calls = request.mock.calls.filter(([command]) => command === 'connections.test' || command === 'connections.save');
    expect(calls.map(([command]) => command)).toEqual(['connections.test', 'connections.save']);
    for (const [, profile] of calls) { expect(profile.rememberPassword, '临时账号的真实表单必须显式关闭密码保存').toBe(false); expect(profile).toMatchObject({ user: '合成临时账号', password: syntheticPassword }); }
    expect(ram.store.volatileSecrets.get('仅RAM合成连接\0password')).toBe(syntheticPassword);
    expect(ram.protector.available).not.toHaveBeenCalled(); expect(ram.protector.encrypt).not.toHaveBeenCalled(); expect(ram.protector.decrypt).not.toHaveBeenCalled();
    expect(ram.secrets.size).toBe(0); expect(ram.profiles.size).toBe(1);
    expect([...ram.profiles.values()].join('')).not.toContain(syntheticPassword);
    expect(JSON.parse([...ram.profiles.values()][0])).toMatchObject({ rememberPassword: false });
    expect(ram.store.connections()[0]).toMatchObject({ hasPassword: true }); expect(ram.store.connections()[0]).not.toHaveProperty('password');
  });

  it('普通新连接仍默认安全保存；显式取消仅影响当前表单', async () => {
    const ram = await mount(); const form = locator(() => document.querySelector('div[role="dialog"]') ?? undefined);
    await form.getByLabel('数据库密码').fill(syntheticPassword); expect(document.querySelector('input[type="checkbox"]')?.checked).toBe(true);
    await form.getByRole('button', { name: '保存连接' }).click();
    expect(request.mock.calls.find(([command]) => command === 'connections.save')?.[1].rememberPassword).toBe(true);
    expect(ram.protector.encrypt).toHaveBeenCalledExactlyOnceWith(syntheticPassword); expect(ram.secrets.size).toBe(1); expect(ram.store.volatileSecrets.size).toBe(0);
    expect([...ram.profiles.values()].join('')).not.toContain(syntheticPassword);
    await act(async () => root!.unmount()); root = undefined; await mount();
    const checkbox = form.getByRole('checkbox', { name: zh.connections.text016 }); await checkbox.uncheck(); await checkbox.uncheck(); expect(checkbox.resolve()?.checked).toBe(false);
    expect(request).not.toHaveBeenCalledWith('connections.save', expect.anything());
  });
});
