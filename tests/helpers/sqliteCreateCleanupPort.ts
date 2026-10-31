import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

/** 原退出回调的RAM端口：运行真实清理函数和真实空账本，既不加载Electron也不吞新收尾分支。 */
export function emptySqliteCreateCleanup(): () => Promise<void> {
  const source = readFileSync(new URL('../../src/main/sqliteDatabaseCreate.ts', import.meta.url), 'utf8');
  const tree = ts.createSourceFile('sqliteDatabaseCreate.ts', source, ts.ScriptTarget.Latest, true);
  const statements = tree.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === 'closeSqliteDatabaseCreates'
    || ts.isVariableStatement(node) && node.declarationList.declarations.some(item => ['resources', 'unconfirmedFiles', 'draining'].includes(item.name.getText(tree))));
  if (statements.length !== 4) throw Error('缺少SQLite新建文件真实空账本或关闭函数');
  const code = statements.map(node => node.getText(tree).replace(/^export /, '')).join('\n') + '\ncloseSqliteDatabaseCreates;';
  return runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText) as () => Promise<void>;
}
