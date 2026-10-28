import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { publicCommands } from '../../src/shared/commands';
import { validateCommand } from '../../src/shared/validation';
import { savedQueryRenameSchema, savedQueryRenameZh as text } from '../../src/shared/savedQueryRename';

const input = { id: '__proto__', digest: 'a'.repeat(64), name: '  新名称🚢 / 查询\\甲  ' };

describe('保存查询重命名的受限IPC及真实Main分发', () => {
  it('仅接收编号、原摘要及名称，不携带正文、连接或文件能力', () => {
    expect(publicCommands['queries.renameChecked']).toBe(true);
    expect(validateCommand('queries.renameChecked', input)).toEqual(input);
    for (const patch of [{ id: '' }, { id: 'x'.repeat(201) }, { digest: 'A'.repeat(64) }, { digest: 'a'.repeat(63) }, { sql: '不允许的正文' }, { connectionId: '任意连接' }, { path: '任意路径' }, { taskId: '后台任务' }, { updatedAt: '' }, { sourceBinding: {} }]) {
      expect(() => validateCommand('queries.renameChecked', { ...input, ...patch })).toThrow();
    }
  });
  it.each(['', ' \u3000 ', '\n名称', '名称\t', '名称\u007f', '\u0085名称', '\ud800', '名称\udfff', 'x'.repeat(257)])('非法名称不被静默修剪或交给Main：%j', name => {
    const result = savedQueryRenameSchema.safeParse({ ...input, name });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.some(issue => issue.message === text.invalidName)).toBe(true);
  });
  it('Unicode和256个UTF16单元边界按原文保留，同名不在IPC合并', () => {
    const name = '🚢'.repeat(128);
    expect(validateCommand('queries.renameChecked', { ...input, name })).toEqual({ ...input, name });
    expect(validateCommand('queries.renameChecked', { ...input, id: '其它编号', name })).toEqual({ ...input, id: '其它编号', name });
  });
  it('正式Main分支仅调用本地原子存储，退出时拒绝；不交给Engine或解密连接', async () => {
    const source = readFileSync(new URL('../../src/main/index.ts', import.meta.url), 'utf8');
    const tree = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true);
    const branches: ts.CaseClause[] = [];
    /** 提取原分支正文，不复制实现或启动Electron bootstrap。 */
    function visit(node: ts.Node): void {
      if (ts.isCaseClause(node) && ts.isStringLiteral(node.expression) && node.expression.text === 'queries.renameChecked') branches.push(node);
      ts.forEachChild(node, visit);
    }
    visit(tree); expect(branches).toHaveLength(1);
    const rename = vi.fn(), unexpected = vi.fn(() => { throw Error('禁止数据库或凭据访问'); });
    const context = createContext({ Error, shuttingDown: false, store: { renameQueryChecked: rename, resolveConnection: unexpected }, broker: { request: unexpected } });
    const code = 'globalThis.dispatch=async function(command,input){' + branches[0].statements.map(statement => statement.getText(tree)).join('\n') + '}';
    runInContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
    await expect(context.dispatch('queries.renameChecked', input)).resolves.toBeUndefined(); expect(rename).toHaveBeenCalledExactlyOnceWith(input);
    context.shuttingDown = true;
    await expect(context.dispatch('queries.renameChecked', input)).rejects.toThrow('正在退出'); expect(rename).toHaveBeenCalledTimes(1); expect(unexpected).not.toHaveBeenCalled();
  });
});
