import { describe, expect, it } from 'vitest';
import { validateTableRenameName, tableRenameAcknowledgements } from '../../src/shared/tableRename';
import { planTableRename, renameDefinitionBody } from '../../src/engine/tableRenameSql';
import { proveRenamePrivileges } from '../../src/engine/tableRenameRead';
import { sameTableRenameTarget, tableRenameAcksComplete, tableRenameAckLabel, tableRenameFailure, TableRenameRequestFence } from '../../src/renderer/tableRenameUi';
import { assertTableRenameTargetAvailable } from '../../src/renderer/tableRenameServices';
import { reconcileTableRenameFavorites, tableRenameTabMatches } from '../../src/renderer/tableRenameReconcile';
import { emptyWorkbench } from '../../src/shared/workbench';
import { validateCommand } from '../../src/shared/validation';
import { assertTableRenameLiveTarget } from '../helpers/tableRenameTarget';

const target = { connectionId: 'c', database: 'db', table: 't' }, mode = { dialect: 'mysql' as const, mode: { noBackslashEscapes: true, ansiQuotes: true } };
describe('表重命名输入、权限与界面边界', () => {
  it('核心/UI准备门要求显式200六实例，严格TLS不降级、不替换CA', () => {
    for (const port of ['13357', '13380', '13384', '13310', '13311']) expect(() => assertTableRenameLiveTarget({ host: 'deve-server.yinzon.com', port })).not.toThrow();
    expect(() => assertTableRenameLiveTarget({ host: 'deve-server.yinzon.com', port: '13484' })).toThrow('TLS');
    expect(() => assertTableRenameLiveTarget({ host: 'deve-server.yinzon.com', port: '13484', tlsFlag: '1', caPath: '仅作准备门校验.pem' }, { host: 'deve-server.yinzon.com', port: 13484, tls: { enabled: true, rejectUnauthorized: true, caPath: '另一CA.pem' } })).toThrow('同一CA');
    for (const host of ['localhost', '127.0.0.1', '未知主机']) expect(() => assertTableRenameLiveTarget({ host, port: '13384' })).toThrow('显式指定');
  });
  it.each(['', ' table', 'table ', 'a.b', 'a;b', '`quoted`', '中文', '1abc', 'a\0b', 'a'.repeat(65)])('名称%j拒绝且不修剪、拆库、截断', value => expect(() => validateTableRenameName(value)).toThrow());
  it('固定SQL只重命名，不允许客户端提供SQL、修订或跨库目标', () => {
    expect(planTableRename(target, 'new_t').sql).toBe('RENAME TABLE `db`.`t` TO `db`.`new_t`;');
    expect(() => planTableRename(target, 't')).toThrow('没有实际');
    expect(validateCommand('schema.tableRename.preview', { snapshotId: 's', newName: 'new_t', taskId: 'p' })).toMatchObject({ newName: 'new_t' });
    expect(() => validateCommand('schema.tableRename.preview', { snapshotId: 's', newName: 'new_t', taskId: 'p', sql: 'DROP TABLE t' })).toThrow();
    expect(() => validateCommand('schema.tableRename.get', { ...target, taskId: 'g', connectionRevision: 1 })).toThrow();
  });
  it('定义豁免只发生在CREATE首部，原列、默认值、约束名及尾选项变化仍被识别', () => {
    const source = "CREATE TABLE `t` (`t` int DEFAULT 1 COMMENT 't', KEY `t` (`t`)) ENGINE=InnoDB COMMENT='t'";
    expect(renameDefinitionBody({ source, context: mode })).toBe(renameDefinitionBody({ source: source.replace('CREATE TABLE `t`', 'CREATE TABLE `new_t`'), context: mode }));
    for (const changed of [source.replace('DEFAULT 1', 'DEFAULT 2'), source.replace("COMMENT='t'", "COMMENT='new_t'"), source.replace('KEY `t`', 'KEY `new_t`')]) expect(renameDefinitionBody({ source: changed, context: mode })).not.toBe(renameDefinitionBody({ source, context: mode }));
  });
  it('直接全局目录可见与精确源/目标DDL授权合并证明；角色、部分撤销、列级权限和引用星号不扩大范围', () => {
    const grants = ["GRANT SELECT, SHOW VIEW, TRIGGER ON *.* TO 'u'@'h'", "GRANT ALTER, DROP ON `db`.`t` TO 'u'@'h'", "GRANT CREATE, INSERT ON `db`.`new_t` TO 'u'@'h'"];
    expect(proveRenamePrivileges(grants, target, mode, 'new_t')).toBe(true);
    expect(proveRenamePrivileges(["GRANT ALL PRIVILEGES ON *.* TO 'u'@'h'"], target, mode, 'new_t')).toBe(true);
    for (const next of [grants.slice(1), [...grants, "REVOKE SELECT ON db.* FROM 'u'@'h'"], [...grants, "GRANT 'role' TO 'u'@'h'"], ["GRANT ALL ON `*`.`*` TO 'u'@'h'"], grants.map(value => value.replace('ALTER, DROP', 'ALTER(id), DROP'))]) expect(proveRenamePrivileges(next, target, mode, 'new_t')).toBe(false);
    expect(proveRenamePrivileges(grants, target, mode, 'elsewhere')).toBe(false);
  });
  it('三项风险必须精确匹配，原型成员和未知确认项不能执行', () => {
    expect(tableRenameAcksComplete(tableRenameAcknowledgements, new Set(tableRenameAcknowledgements))).toBe(true);
    for (const ids of [tableRenameAcknowledgements.slice(0, 2), [...tableRenameAcknowledgements, tableRenameAcknowledgements[0]], ['__proto__', 'constructor']]) expect(tableRenameAcksComplete(ids, new Set(ids))).toBe(false);
    expect(tableRenameAckLabel('__proto__')).toBeUndefined(); expect(tableRenameAckLabel('references-and-grants')).toBeDefined();
  });
  it('精确保护所有隐藏页草稿与活动任务，连接/库/大小写不同不误命中', () => {
    const tab = { id: 'hidden', kind: 'table' as const, title: 't', ...target }, workspace = { settings: { tabs: [tab] }, dirtyTabs: { hidden: true }, activeJobs: {} };
    expect(() => assertTableRenameTargetAvailable(target, workspace)).toThrow('草稿');
    expect(() => assertTableRenameTargetAvailable(target, { ...workspace, dirtyTabs: {}, activeJobs: { hidden: true } })).toThrow('活动任务');
    expect(() => assertTableRenameTargetAvailable(target, { ...workspace, dirtyTabs: {}, tableLayoutDrafts: { hidden: true } })).toThrow('列布局草稿');
    expect(() => assertTableRenameTargetAvailable({ ...target, table: 'T' }, workspace)).not.toThrow();
    expect(sameTableRenameTarget(target, { ...target, database: 'DB' })).toBe(false); expect(tableRenameTabMatches({ ...tab, kind: 'query', sql: 'SELECT * FROM t' }, target)).toBe(false);
  });
  it('新标签不复用旧ID；收藏自定义标签保留，目标冲突不静默删除收藏', () => {
    const document = emptyWorkbench(); document.favorites = [{ id: 'f', groupId: null, label: '业务自定义', target: { connectionId: 'c', database: 'db', kind: 'table', name: 't' } }];
    const result = reconcileTableRenameFavorites(document, target, { ...target, table: 'new_t' });
    expect(result).toMatchObject({ changed: true, conflict: false }); expect(result.document.favorites[0]).toMatchObject({ label: '业务自定义', target: { name: 'new_t' } }); expect(document.favorites[0].target).toMatchObject({ name: 't' });
    document.favorites.push({ id: 'd', groupId: null, label: 'new_t', target: { connectionId: 'c', database: 'db', kind: 'table', name: 'new_t' } });
    expect(reconcileTableRenameFavorites(document, target, { ...target, table: 'new_t' })).toMatchObject({ changed: false, conflict: true, document });
  });
  it('取消保持busy直至真实finally，卸载和新代次拒绝迟到响应；失败不推断未执行', () => {
    const guard = new TableRenameRequestFence(), old = guard.begin('one')!; expect(guard.begin('two')).toBeUndefined(); guard.cancel(); expect(guard.busy).toBe(true); expect(guard.accepts(old)).toBe(false); guard.finish(old); const next = guard.begin('two')!; expect(guard.accepts(old)).toBe(false); guard.dispose(); expect(guard.accepts(next)).toBe(false);
    expect(tableRenameFailure(null, true)).toBe('unknown'); expect(tableRenameFailure({ phase: 'releasing', ddlSubmitted: true, ddlCompleted: true, definitionVerified: false, outcome: 'succeeded' }, true)).toBe('verificationFailed');
  });
});
