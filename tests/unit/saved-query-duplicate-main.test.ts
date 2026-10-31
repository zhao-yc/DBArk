import { readFileSync } from 'node:fs';
import { createContext, runInContext, runInNewContext } from 'node:vm';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import { publicCommands } from '../../src/shared/commands';
import { validateCommand } from '../../src/shared/validation';
import { savedQueryDuplicateName } from '../../src/shared/savedQueryDuplicate';

const input = { id: '__proto__', digest: 'a'.repeat(64), expectedRevision: 'b'.repeat(64), name: '副本' };
it('复制IPC仅接收原引用、组织版本和合法名称，不接受SQL或任意目标编号', () => {
  expect(publicCommands['queries.duplicateChecked']).toBe(true); expect(validateCommand('queries.duplicateChecked', input)).toEqual(input);
  for (const patch of [{ sql: 'SELECT 1' }, { connectionId: 'c' }, { path: 'x' }, { targetId: 'source' }, { expectedRevision: '' }, { digest: 'A'.repeat(64) }, { name: '\ud800' }, { name: 'x'.repeat(257) }, { id: '' }]) expect(() => validateCommand('queries.duplicateChecked', { ...input, ...patch })).toThrow();
});
it.each(['普通名称', '🚢'.repeat(128), 'a'.repeat(251) + '🚢🚢', ' '.repeat(256)])('默认副本名预算不截断代理对：%s', name => {
  const next = savedQueryDuplicateName(name); expect(next.length).toBeLessThanOrEqual(256); expect(next.endsWith('（副本）')).toBe(true);
  expect(validateCommand('queries.duplicateChecked', { ...input, name: next })).toEqual({ ...input, name: next });
});
it('真实Main仅分发本地存储，退出时拒绝，不访问Engine或连接凭据', async () => {
  const source = readFileSync(new URL('../../src/main/index.ts', import.meta.url), 'utf8'), tree = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true), branches: ts.CaseClause[] = [];
  /** 提取真实分支而不启动Electron或复制业务实现。 */
  function visit(node: ts.Node): void { if (ts.isCaseClause(node) && ts.isStringLiteral(node.expression) && node.expression.text === 'queries.duplicateChecked') branches.push(node); ts.forEachChild(node, visit); }
  visit(tree); expect(branches).toHaveLength(1);
  const duplicate = vi.fn(), context = createContext({ Error, shuttingDown: false, store: { duplicateQueryChecked: duplicate } });
  runInContext(ts.transpileModule('globalThis.dispatch=async function(input){' + branches[0].statements.map(statement => statement.getText(tree)).join('\n') + '}', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  await context.dispatch(input); expect(duplicate).toHaveBeenCalledExactlyOnceWith(input);
  context.shuttingDown = true; await expect(context.dispatch(input)).rejects.toThrow('正在退出'); expect(duplicate).toHaveBeenCalledTimes(1);
});
it.each([{ argv: [] as string[] }, { argv: ['--list'] }])('原生专项默认和列表模式均不加载桌面资源：%j', ({ argv }) => {
  const source = readFileSync(new URL('../e2e/saved-query-duplicate-offline.spec.ts', import.meta.url), 'utf8'), skip = vi.fn();
  const require = vi.fn((name: string) => { if (name === '@playwright/test') return { test: { skip } }; throw Error('不得加载桌面或配置'); });
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: {}, require, process: { argv, env: argv.length ? { DBARK_SAVED_QUERY_DUPLICATE_NATIVE: '1' } : {} } });
  expect(skip).toHaveBeenCalledOnce(); expect(require.mock.calls).toEqual([['@playwright/test']]);
});
