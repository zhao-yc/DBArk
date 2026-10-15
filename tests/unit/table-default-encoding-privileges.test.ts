import { describe, expect, it } from 'vitest';
import { proveTableDefaultEncodingAlter } from '../../src/engine/tableDefaultEncodingPrivileges';
const target = { database: 'db', table: 't' }, context = { dialect: 'mysql' as const, mode: { noBackslashEscapes: false, ansiQuotes: false } };
describe('默认编码只证明直接ALTER授权', () => {
  it.each(['GRANT ALL PRIVILEGES ON *.* TO `u`@`h`', 'GRANT SELECT, ALTER ON `db`.* TO `u`@`h`', 'GRANT ALTER ON `db`.`t` TO `u`@`h`', "GRANT ALL ON *.* TO 'u'@'h' IDENTIFIED BY PASSWORD '*假摘要'"])('直接已匹配授权可证明：%s', grant => { expect(proveTableDefaultEncodingAlter([grant], target, context)).toBe(true); });
  it.each(['GRANT ALTER ROUTINE ON *.* TO `u`@`h`', 'GRANT SELECT ON *.* TO `u`@`h`', 'GRANT ALTER ON `other`.* TO `u`@`h`', 'GRANT ALTER ON `db%`.* TO `u`@`h`', 'GRANT ALTER ON `DB`.`t` TO `u`@`h`', 'GRANT ALTER ON PROCEDURE `db`.`t` TO `u`@`h`', 'GRANT ALTER ON `*`.`*` TO `u`@`h`', "GRANT 'role' TO 'u'@'h'"])('未证明的授权只读：%s', grant => { expect(proveTableDefaultEncodingAlter([grant], target, context)).toBe(false); });
  it('部分撤销、角色、默认角色或可执行授权片段不被直接全局授权遮蔽', () => {
    const direct = 'GRANT ALL PRIVILEGES ON *.* TO `u`@`h`';
    for (const other of ['REVOKE ALTER ON `db`.* FROM `u`@`h`', "GRANT 'role' TO 'u'@'h'", "SET DEFAULT ROLE 'role'", 'GRANT /*!80000 ALTER */ ON `db`.* TO `u`@`h`']) expect(proveTableDefaultEncodingAlter([direct, other], target, context)).toBe(false);
  });
});
