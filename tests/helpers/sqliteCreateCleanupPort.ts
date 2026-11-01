import { SqliteTableMaintenanceMain } from '../../src/main/sqliteTableMaintenanceMain';
import { SqliteTableRenameMain } from '../../src/main/sqliteTableRenameMain';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { SqliteTableCreateMain } from '../../src/main/sqliteTableCreateMain';
import { SqliteTableImportMain } from '../../src/main/sqliteTableImportMain';
import { SqliteIndexesMain } from '../../src/main/sqliteIndexesMain';
import { SqliteColumnsMain } from '../../src/main/sqliteColumnsMain';

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

/** 旧退出场景未登记索引操作，仍执行真实索引协调器的初始空账本收尾。 */
export function emptySqliteIndexesMain(): SqliteIndexesMain {
  const unexpected = () => { throw Error('旧退出夹具未登记SQLite索引操作'); };
  return new SqliteIndexesMain({ assert: unexpected, same: unexpected, revision: () => 0, epoch: () => ({}), available: unexpected, closing: () => false, profile: () => undefined, request: async () => unexpected(), task: () => undefined, replace: unexpected, save: unexpected, event: unexpected });
}

/** 原退出场景没有字段修改，仍须执行真实字段协调器的空账本drain。 */
export function emptySqliteColumnsMain(): SqliteColumnsMain {
  const unexpected = () => { throw Error('旧退出夹具未登记SQLite字段操作'); };
  return new SqliteColumnsMain({ assert: unexpected, same: unexpected, revision: () => 0, epoch: () => ({}), available: unexpected, closing: () => false, profile: () => undefined, request: async () => unexpected(), task: () => undefined, replace: unexpected, save: unexpected, event: unexpected });
}

/** 原退出场景没有表重命名，仍执行真实协调器的空账本drain。 */
export function emptySqliteTableRenameMain(): SqliteTableRenameMain {
  const unexpected = () => { throw Error('旧退出夹具未登记SQLite表重命名操作'); };
  return new SqliteTableRenameMain({ assert: unexpected, same: unexpected, revision: () => 0, epoch: () => ({}), available: unexpected, closing: () => false, profile: () => undefined, request: async () => unexpected(), task: () => undefined, replace: unexpected, save: unexpected, event: unexpected });
}

/** 原退出场景没有表维护，仍执行真实协调器的空账本drain。 */
export function emptySqliteTableMaintenanceMain(): SqliteTableMaintenanceMain {
  const unexpected = () => { throw Error('旧退出夹具未登记SQLite表维护操作'); };
  return new SqliteTableMaintenanceMain({ assert: unexpected, same: unexpected, revision: () => 0, epoch: () => ({}), available: unexpected, closing: () => false, profile: () => undefined, request: async () => unexpected(), task: () => undefined, replace: unexpected, save: unexpected, event: unexpected });
}
