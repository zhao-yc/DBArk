import { describe, expect, it } from 'vitest';
import { mysqlDumpOptionFile } from '../../src/engine/databaseBackupNativeOptions';
import { databaseBackupGlobalGrants } from '../../src/engine/databaseBackupSource';
import { parseMysqlDumpVersion } from '../../src/engine/mysqlDumpTool';
import { mysqlDatabaseBackupExecuteSchema } from '../../src/shared/mysqlDatabaseBackup';

describe('MySQL／MariaDB 原生整库备份参数', () => {
  it('识别不同工具的实际版本格式，拒绝用错系列', () => {
    expect(parseMysqlDumpVersion('mysql', 'mysqldump  Ver 8.3.0 for macos14.2 on arm64 (Homebrew)')).toBe('8.3.0');
    expect(parseMysqlDumpVersion('mysql', 'C:\\bin\\mysqldump.exe  Ver 8.4.11 for Win64 on x86_64')).toBe('8.4.11');
    expect(parseMysqlDumpVersion('mariadb', '/opt/bin/mariadb-dump from 11.4.13-MariaDB, client 10.19 for osx10.23 (arm64)')).toBe('11.4.13');
    expect(parseMysqlDumpVersion('mariadb', 'mariadb-dump Ver 10.19 Distrib 11.4.13-MariaDB, for debian-linux-gnu (aarch64)')).toBe('11.4.13');
    expect(parseMysqlDumpVersion('mysql', 'mysqldump Ver 10.19 Distrib 11.4.13-MariaDB, for debian-linux-gnu')).toBeUndefined();
  });

  it('密码只能进入受控选项文件，换行、反斜线和注释字符保留为一个值', () => {
    const options = mysqlDumpOptionFile('test user', "fake#'\\value\n[evil]");
    expect(options).toBe(`[client]\nuser="test\\suser"\npassword="fake#\\'\\\\value\\n[evil]"\n`);
    expect(() => mysqlDumpOptionFile('test', 'bad\0value')).toThrow();
  });

  it('附加例程授权不遮盖直接全局权限，部分撤销仍拒绝', () => {
    const grants = [
      { grant: 'GRANT SELECT, SHOW VIEW ON *.* TO `test`@`%`' },
      { grant: 'GRANT ALTER ROUTINE, EXECUTE ON PROCEDURE `example`.`p` TO `test`@`%`' },
    ];
    const mode = { dialect: 'mysql' as const, mode: { ansiQuotes: false, noBackslashEscapes: false } };
    const proof = databaseBackupGlobalGrants(grants, 'test@%', 'mysql', mode, false, true);
    expect(proof).toEqual({ known: true, privileges: new Set(['SELECT', 'SHOW VIEW']) });
    const revoke = { grant: 'REVOKE SELECT ON `example`.* FROM `test`@`%`' };
    expect(databaseBackupGlobalGrants([...grants, revoke], 'test@%', 'mysql', mode, false, true).known).toBe(false);
  });

  it('保留 MariaDB 账号的 TLS 登录条件并核对全局授权', () => {
    const mode = { dialect: 'mariadb' as const, mode: { ansiQuotes: false, noBackslashEscapes: false } };
    const grants = [{ grant: "GRANT SELECT, SHOW CREATE ROUTINE ON *.* TO `test`@`%` IDENTIFIED BY PASSWORD '*test' REQUIRE SSL" }];
    expect(databaseBackupGlobalGrants(grants, 'test@%', 'mariadb', mode, true, true))
      .toEqual({ known: true, privileges: new Set(['SELECT', 'SHOW CREATE ROUTINE']) });
  });

  it('拒绝系统库、选项型库名以及渲染器传入的路径', () => {
    const token = '26bc6b95-1c96-420f-a765-be66b44b74f0';
    const input = { connectionId: 'connection', taskId: 'task', database: '迁移测试', toolToken: token,
      fileToken: token, acknowledgeSnapshot: true };
    expect(mysqlDatabaseBackupExecuteSchema.safeParse(input).success).toBe(true);
    for (const database of ['mysql', 'performance_schema', '--result-file=bad', 'bad\nname'])
      expect(mysqlDatabaseBackupExecuteSchema.safeParse({ ...input, database }).success).toBe(false);
    expect(mysqlDatabaseBackupExecuteSchema.safeParse({ ...input, filePath: '/tmp/bad.sql' }).success).toBe(false);
    expect(mysqlDatabaseBackupExecuteSchema.safeParse({ ...input, acknowledgeSnapshot: false }).success).toBe(false);
  });
});
