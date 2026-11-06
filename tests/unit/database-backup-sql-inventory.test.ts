import { describe, expect, it } from 'vitest';
import { DatabaseBackupSqlInventoryReader } from '../../src/engine/databaseBackupSqlInventory';
import type { DatabaseBackupKind } from '../../src/shared/databaseBackup';

const database = '归档库';
const manifest = {
  family: 'mysql' as const, serverVersion: '8.4.11', database,
  objects: [{ kind: 'database' as const, name: database }, { kind: 'table' as const, name: '账本' }]
    .map(item => ({ ...item, definitionSha256: '0'.repeat(64) }))
};
const header = `/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
CREATE DATABASE /*!32312 IF NOT EXISTS*/ \`${database}\`;
USE \`${database}\`;
CREATE TABLE \`账本\` (id int);
`;
async function inventory(sql: string | Uint8Array, input: ConstructorParameters<typeof DatabaseBackupSqlInventoryReader>[0] = manifest) {
  const reader = new DatabaseBackupSqlInventoryReader(input), bytes = Buffer.from(sql);
  // 每块只有七字节，覆盖中文、分隔符和转义字符跨块的情况。
  for (let offset = 0; offset < bytes.length; offset += 7) await reader.writeBytes(bytes.subarray(offset, offset + 7));
  return reader.finish();
}
const withObject = (kind: DatabaseBackupKind, name: string) => ({ ...manifest, objects: [...manifest.objects, { kind, name, definitionSha256: null }] });

describe('数据库备份 SQL 对象检查', () => {
  it('模式变化、分隔符、版本注释及定义者按脚本顺序解析', async () => {
    const script = header + [
      "SET @saved=@@SQL_MODE, SQL_MODE='ANSI_QUOTES,NO_BACKSLASH_ESCAPES';",
      "INSERT INTO \"账本\" VALUES ('只有反斜线\\');",
      'SET sql_mode=@saved;',
      'DELIMITER ;;',
      '/*!50003 CREATE*/ /*!50017 DEFINER=`u`@`h`*/ /*!50003 PROCEDURE `过程`() BEGIN SELECT \'USE fake;\'; END */;;',
      'DELIMITER ;',
      '/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;',
    ].join('\n');
    await expect(inventory(script, withObject('procedure', '过程'))).resolves.toMatchObject({
      state: 'matches', dataStatements: 1, definitions: 3, otherStatements: 0, databases: [database], definers: ['u@h'], reason: null
    });
  });

  it('对显式异库、清单多余项和最后被删除的定义报告差异', async () => {
    const result = await inventory(header + `DROP TABLE \`账本\`; CREATE TABLE \`替代\`(id int); USE other; INSERT INTO log VALUES (1);`);
    expect(result).toMatchObject({
      state: 'differs', databases: [database, 'other'], dataStatements: 1,
      missing: { total: 1, items: [{ kind: 'table', name: '账本' }] }, extra: { total: 1, items: [{ kind: 'table', name: '替代' }] },
    });
  });

  it('MariaDB 不把沙箱前缀或不适用的 MySQL 条件体当作对象', async () => {
    const script = '/*M!999999\\- enable the sandbox mode */\n' + header + '/*!80000 CREATE DATABASE hidden */; /*M!100616 SET NOTE_VERBOSITY=0 */;';
    await expect(inventory(script, { ...manifest, family: 'mariadb', serverVersion: '11.4.13' })).resolves.toMatchObject({
      state: 'matches', databases: [database], otherStatements: 0,
    });
  });

  it('动态、编码无效和未闭合脚本只发布部分结论', async () => {
    await expect(inventory(header + "PREPARE x FROM 'DROP DATABASE fake';")).resolves.toMatchObject({ state: 'partial', otherStatements: 1 });
    await expect(inventory(header + 'CREATE TABLE `x')).resolves.toMatchObject({ state: 'partial', reason: 'lexical' });
    await expect(inventory(header + 'CREATE TABLE `x` (')).resolves.toMatchObject({ state: 'partial', reason: 'lexical' });
    await expect(inventory(header + '/*!804119CREATE DATABASE other */;')).resolves.toMatchObject({ state: 'partial', reason: 'lexical' });
    await expect(inventory(Buffer.concat([Buffer.from(header), Buffer.from([0xff])]))).resolves.toMatchObject({ state: 'partial', reason: 'encoding' });
    await expect(inventory(header, { ...manifest, serverVersion: '未知' })).resolves.toMatchObject({ state: 'partial', reason: 'version' });
  });
});
