import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { SqliteTableCreateMain } from '../../src/main/sqliteTableCreateMain';
import { SqliteTableImportMain } from '../../src/main/sqliteTableImportMain';

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

/** 旧退出场景未开始建表，仍调用真实协调器的初始空账本drain。 */
export function emptySqliteTableCreateMain(): SqliteTableCreateMain {
  const unexpected = () => { throw Error('旧退出夹具未登记SQLite建表操作'); };
  return new SqliteTableCreateMain({ assert: unexpected, same: unexpected, revision: () => 0, epoch: () => ({}), available: unexpected, closing: () => false, profile: () => undefined, request: async () => unexpected(), task: () => undefined, replace: unexpected, save: unexpected, event: unexpected });
}

/** 旧退出用例没有导入任务，仍执行真实导入协调器的初始空账本收尾。 */
export function emptySqliteTableImportMain(): SqliteTableImportMain {
  const unexpected = () => { throw Error('旧退出夹具未登记SQLite导入操作'); };
  return new SqliteTableImportMain({ assert: unexpected, same: unexpected, revision: () => 0, epoch: () => ({}), available: unexpected, closing: () => false, profile: () => undefined, file: unexpected, request: async () => unexpected(), task: () => undefined, replace: unexpected, save: unexpected, event: unexpected });
}
