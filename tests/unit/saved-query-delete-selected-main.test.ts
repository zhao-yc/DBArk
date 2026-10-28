import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { publicCommands } from '../../src/shared/commands';
import { validateCommand } from '../../src/shared/validation';
import { readSavedQueryDeleteSelectedResult, savedQueryDeleteSelectedZh as text } from '../../src/shared/savedQueryDeleteSelected';

const reference = (index = 0) => ({ id: '查询-' + index, digest: index.toString(16).padStart(64, '0') });

describe('保存查询批量删除的受限IPC与正式Main分发', () => {
  it('准确接收1或100个不同引用，只含id和原摘要，不携带SQL或连接能力', () => {
    expect(publicCommands['queries.deleteSelectedChecked']).toBe(true);
    for (const count of [1, 100]) {
      const input = { queries: Array.from({ length: count }, (_, index) => reference(index)) };
      expect(validateCommand('queries.deleteSelectedChecked', input)).toEqual(input);
    }
    for (const input of [{ queries: [] }, { queries: Array.from({ length: 101 }, (_, index) => reference(index)) }, { queries: [reference(), reference()] }, { queries: [reference()], sql: 'DELETE' }, { queries: [{ ...reference(), connectionId: 'c' }] }, { queries: [{ ...reference(), path: 'file.sql' }] }, { queries: [{ ...reference(), id: '' }] }, { queries: [{ ...reference(), digest: 'A'.repeat(64) }] }]) {
      expect(() => validateCommand('queries.deleteSelectedChecked', input)).toThrow();
    }
  });
  it('getter/符号/稀疏数组/附加字段/陌生原型拒绝，零读取调用者访问器', () => {
    const getter = vi.fn(() => reference()), values = [reference()];
    const inputs = [
      Object.defineProperty({}, 'queries', { enumerable: true, get: getter }),
      { queries: [Object.defineProperty({ digest: 'a'.repeat(64) }, 'id', { enumerable: true, get: getter })] },
      { queries: Object.defineProperty([], '0', { enumerable: true, get: getter }) },
      { queries: new Array(1) },
      { queries: Object.assign(values, { extra: 1 }) },
      { queries: [Object.assign(reference(), { [Symbol('extra')]: true })] },
      { queries: [Object.assign(Object.create({ external: true }), reference())] },
    ];
    for (const input of inputs) expect(() => validateCommand('queries.deleteSelectedChecked', input)).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });
  it('回执数量及形状必须准确，错误或未知回执不能冒称全删成功', () => {
    expect(readSavedQueryDeleteSelectedResult({ deleted: 100 }, 100)).toEqual({ deleted: 100 });
    const getter = vi.fn(() => 2);
    for (const raw of [null, undefined, [], { deleted: 1 }, { deleted: 2, id: 'extra' }, Object.defineProperty({}, 'deleted', { get: getter })]) expect(() => readSavedQueryDeleteSelectedResult(raw, 2)).toThrow(text.failed);
    for (const expected of [0, 101, 1.5]) expect(() => readSavedQueryDeleteSelectedResult({ deleted: expected }, expected)).toThrow(text.failed);
    expect(getter).not.toHaveBeenCalled();
  });
  it('提取唯一正式Main分支，仅调用本地单事务方法；退出时拒绝，不访问Engine或凭据', async () => {
    const source = readFileSync(new URL('../../src/main/index.ts', import.meta.url), 'utf8');
    const tree = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true), branches: ts.CaseClause[] = [];
    /** 提取原分支正文，不复制实现，不启动Electron。 */
    function visit(node: ts.Node): void { if (ts.isCaseClause(node) && ts.isStringLiteral(node.expression) && node.expression.text === 'queries.deleteSelectedChecked') branches.push(node); ts.forEachChild(node, visit); }
    visit(tree); expect(branches).toHaveLength(1);
    const remove = vi.fn(() => ({ deleted: 2 })), unexpected = vi.fn(() => { throw Error('禁止数据库或凭据访问'); });
    const context = createContext({ Error, shuttingDown: false, store: { deleteQueriesChecked: remove, resolveConnection: unexpected }, broker: { request: unexpected } });
    const code = 'globalThis.dispatch=async function(command,input){' + branches[0].statements.map(statement => statement.getText(tree)).join('\n') + '}';
    runInContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
    const input = { queries: [reference(), reference(1)] };
    await expect(context.dispatch('queries.deleteSelectedChecked', input)).resolves.toEqual({ deleted: 2 }); expect(remove).toHaveBeenCalledExactlyOnceWith(input);
    context.shuttingDown = true;
    await expect(context.dispatch('queries.deleteSelectedChecked', input)).rejects.toThrow('正在退出'); expect(remove).toHaveBeenCalledTimes(1); expect(unexpected).not.toHaveBeenCalled();
  });
});
