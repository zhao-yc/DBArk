import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';

/** 仅执行原生专项的实际观察器声明；不加载Playwright、Electron或服务器。 */
function observer() {
  const source = readFileSync(new URL('../e2e/table-query-template.spec.ts', import.meta.url), 'utf8'), tree = ts.createSourceFile('observer.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declaration = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'observeTemplates');
  if (!declaration) throw Error('缺少真实观察器声明');
  const code = ts.transpileModule(declaration.getText(tree), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  return new Function(code + '\nreturn observeTemplates;')();
}
afterEach(() => { delete (globalThis as any).__tableQueryTemplates; });
const columns = ['id', 'amount', 'note', 'bin'].map((name, index) => ({ name, key: 'c' + index, type: '合成类型' }));

describe('查询模板真实观察器的任意SQL内部列键', () => {
  it('61行原回包按元数据键定位空串，不读取显示名称或改写原数据', async () => {
    const rows = Array.from({ length: 61 }, (_, index) => ({ c0: String(index + 1), c1: '0.12345678901234567890', c2: index === 0 ? '' : null, c3: { type: 'binary', base64: 'AP8=' } }));
    const reply = { ok: true, result: { results: [{ columns, rows }] } }, before = structuredClone(reply), handlers = new Map([['dbark:request', async () => reply]]);
    observer()({ ipcMain: { _invokeHandlers: handlers } }, { database: 'RAM', connectionId: 'RAM', select: 'SELECT原文', update: 'UPDATE模板' });
    expect(await (handlers.get('dbark:request') as any)({}, { command: 'query.execute', input: { sql: 'SELECT原文' } })).toBe(reply);
    expect((globalThis as any).__tableQueryTemplates).toMatchObject({ rows: 61, note: '', pending: 0, selects: 1, writes: 0 }); expect(reply).toEqual(before);
  });
  it.each(['重复内部键', '只带显示名'] as const)('%s不能借空值默认或显示名回退制造通过', async kind => {
    const result = { columns: kind === '重复内部键' ? columns.map((column, index) => index === 2 ? { ...column, key: 'c0' } : column) : columns, rows: kind === '只带显示名' ? [{ id: '1', note: '' }] : [{ c0: '1', c2: '' }] };
    const handlers = new Map([['dbark:request', async () => ({ ok: true, result: { results: [result] } })]]);
    observer()({ ipcMain: { _invokeHandlers: handlers } }, { database: 'RAM', connectionId: 'RAM', select: 'SELECT原文', update: 'UPDATE模板' });
    await expect((handlers.get('dbark:request') as any)({}, { command: 'query.execute', input: { sql: 'SELECT原文' } })).rejects.toThrow(); expect((globalThis as any).__tableQueryTemplates.pending).toBe(0);
  });
});
