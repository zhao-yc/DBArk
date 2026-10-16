import { describe, expect, it } from 'vitest';
import type { TableDesign, TableInfo } from '../../src/shared/contracts';
import { buildChanges, buildDesign, buildPageSql, columnType, deserializeCell, exportLiteral, identifier, inlineParameters, mariaDefault, serializeCell, splitSql, SqlScriptScanner, stringLiteral } from '../../src/engine/sql';

const table: TableInfo = {
  database: '测试库', name: 'items', columns: [
    { name: 'id', type: 'bigint', nullable: false, defaultValue: null, extra: '', comment: '', generated: false },
    { name: 'title', type: 'varchar(100)', nullable: true, defaultValue: null, extra: '', comment: '', generated: false },
  ], indexes: [{ name: 'PRIMARY', unique: true, columns: ['id'] }], foreignKeys: [], primaryKey: ['id'], editableKey: ['id'], engine: 'InnoDB', ddl: '',
};
const design: TableDesign = { database: '测试库', name: 'items', engine: 'InnoDB', charset: 'utf8mb4', comment: '测试表', columns: [
  { name: 'id', type: 'BIGINT UNSIGNED', nullable: false, autoIncrement: true, comment: '' },
  { name: 'title', type: 'VARCHAR(100)', nullable: true, defaultValue: null, autoIncrement: false, comment: "客户的'名称" },
], indexes: table.indexes, foreignKeys: [] };

describe('SQL 脚本扫描器', () => {
  it('保留字符串、引用标识符和注释中的分号', () => {
    const result = splitSql("-- 开头注释;\nSELECT 'a; b', `含;号`, \"c;d\"; # 尾注释;\nSELECT 2 /* ; */;");
    expect(result).toHaveLength(2); expect(result[0]).toContain("'a; b'"); expect(result[1]).toContain('SELECT 2');
  });
  it('识别 DELIMITER 并完整保留存储过程体', () => {
    const result = splitSql("DELIMITER $$\nCREATE PROCEDURE p() BEGIN SELECT ';'; SELECT 2; END$$\nDELIMITER ;\nCALL p();");
    expect(result).toEqual(["CREATE PROCEDURE p() BEGIN SELECT ';'; SELECT 2; END", 'CALL p()']);
  });
  it('按任意字符边界输入仍能得到相同语句', () => {
    const script = "/* 说明 */\nDELIMITER //\nCREATE PROCEDURE p() BEGIN SELECT 'a\\\'b;'; END//\nDELIMITER ;\nSELECT 2;";
    const scanner = new SqlScriptScanner(), rows: string[] = [];
    for (const char of script) rows.push(...scanner.push(char));
    rows.push(...scanner.push('', true));
    expect(rows).toEqual(splitSql(script)); expect(rows).toHaveLength(2);
  });
  it('支持双引号转义和无反斜线 SQL 模式', () => {
    expect(splitSql("SELECT 'a''b'; SELECT `a``b`;", true)).toHaveLength(2);
    expect(splitSql("SELECT 'C:\\'; SELECT 2;", true)).toHaveLength(2);
    expect(() => splitSql("SELECT 'C:\\'; SELECT 2;")).toThrow('未闭合');
  });
  it('忽略普通注释但执行 MySQL 版本注释', () => {
    expect(splitSql('-- 只有注释\n/* 注释 */;# 注释')).toEqual([]);
    expect(splitSql('/*!40101 SET NAMES utf8mb4 */;')).toEqual(['/*!40101 SET NAMES utf8mb4 */']);
  });
  it('未闭合输入不执行半条语句', () => {
    expect(() => splitSql("SELECT '没有结束")).toThrow('未闭合');
    expect(() => splitSql('SELECT 1 /* 没有结束')).toThrow('未闭合');
  });
});

describe('标识符与安全 SQL 生成', () => {
  it('把注入文本作为单个标识符并拒绝 NUL', () => {
    expect(identifier('x`; DROP TABLE t; --')).toBe('`x``; DROP TABLE t; --`');
    expect(() => identifier('x\0')).toThrow(); expect(() => identifier('')).toThrow();
  });
  it('筛选值始终绑定参数，排序必须来自元数据', () => {
    const result = buildPageSql(table, 2, 50, [{ column: 'title', operator: '=', value: "' OR 1=1 --" }], []);
    expect(result.sql).toContain('`title` = ?'); expect(result.sql).toContain('ORDER BY `id` ASC LIMIT 51 OFFSET 50');
    expect(result.sql).not.toContain('OR 1=1'); expect(result.params).toEqual(["' OR 1=1 --"]);
    expect(() => buildPageSql(table, 1, 50, [], [{ column: 'id', direction: 'DESC; DROP TABLE t' as 'DESC' }])).toThrow();
    expect(() => buildPageSql(table, 0, 50, [], [])).toThrow();
  });
  it('接受常用类型并拒绝注入、任意表达式和不闭合枚举', () => {
    expect(columnType('decimal(30, 12) unsigned')).toBe('DECIMAL(30, 12) UNSIGNED');
    expect(columnType("ENUM('一','二''三')")).toContain('ENUM');
    for (const type of ['INT); DROP TABLE x; --', 'INT DEFAULT (SELECT 1)', "ENUM('a') COMMENT 'x'", 'VARCHAR(20) CHARACTER SET evil']) expect(() => columnType(type)).toThrow();
  });
  it('字符文字量同时兼容两种反斜线模式', () => {
    expect(stringLiteral("a'\\b")).toBe("'a''\\\\b'");
    expect(stringLiteral("a'\\b", true)).toBe("'a''\\b'");
  });
  it('流式分页内联值不会替换标识符内部的问号', () => {
    expect(inlineParameters('SELECT * FROM `a?``b` WHERE `c?` = ?', ["'\\"])).toBe("SELECT * FROM `a?``b` WHERE `c?` = _utf8mb4 X'275c'");
    expect(() => inlineParameters('SELECT ?', [])).toThrow('缺少参数');
  });
});

describe('精度和二进制', () => {
  it('保留 BIGINT、DECIMAL、日期时间原文', () => {
    for (const value of ['18446744073709551615', '123456789012345678.1234567890', '2026-10-13 12:34:56.123456', '0000-00-00']) expect(serializeCell(value)).toBe(value);
    expect(serializeCell(18446744073709551615n)).toBe('18446744073709551615');
    expect(() => serializeCell(new Date())).toThrow('dateStrings');
  });
  it('二进制往返无损且 SQL 导出不依赖反斜线转义', () => {
    const buffer = Buffer.from([0, 1, 255, 39, 92]);
    const cell = serializeCell(buffer); expect(deserializeCell(cell)).toEqual(buffer);
    expect(exportLiteral(cell)).toBe("X'0001ff275c'");
    expect(exportLiteral("a'\\")).toBe("_utf8mb4 X'61275c'");
  });
});

describe('数据修改的乐观锁', () => {
  it('先用键定位再比较完整旧值，并保留 NULL', () => {
    const result = buildChanges(table, [{ kind: 'update', before: { id: '9007199254740993', title: null }, values: { title: '新值' } }]);
    expect(result.statements[0].sql).toContain('WHERE `id` <=> ? AND BINARY CONVERT(`title` USING utf8mb4) <=> BINARY CONVERT(? USING utf8mb4)');
    expect(result.statements[0].params).toEqual(['新值', '9007199254740993', null]);
  });
  it('缺少可靠唯一键、非事务引擎、旧行缺列时拒绝写入', () => {
    const changes = [{ kind: 'delete' as const, before: { id: '1' } }];
    expect(() => buildChanges({ ...table, editableKey: [] }, changes)).toThrow('唯一键');
    expect(() => buildChanges({ ...table, engine: 'MyISAM' }, changes)).toThrow('InnoDB');
    expect(() => buildChanges(table, changes)).toThrow('完整原始行');
  });
  it('禁止修改生成列与未在元数据中的字段', () => {
    expect(() => buildChanges(table, [{ kind: 'insert', values: { evil: '1' } }])).toThrow('未知字段');
    expect(() => buildChanges({ ...table, columns: table.columns.map(column => ({ ...column, generated: column.name === 'title' })) }, [{ kind: 'insert', values: { title: 'x' } }])).toThrow('生成列');
  });
  it.each(['varchar(100)', 'char(10)', 'tinytext', 'text', 'mediumtext', 'longtext', "enum('café','autre')", "set('a','b')", 'json'])('文本类型 %s 统一字符集后按字节比较，参数保留原始 Unicode 与尾空格', type => {
    const info = { ...table, columns: [table.columns[0], { ...table.columns[1], type }] };
    const original = 'café ';
    const result = buildChanges(info, [{ kind: 'delete', before: { id: '1', title: original } }]);
    expect(result.statements[0].sql).toContain('BINARY CONVERT(`title` USING utf8mb4) <=> BINARY CONVERT(? USING utf8mb4)');
    expect(result.statements[0].sql).not.toContain('BINARY `title`');
    expect(result.statements[0].params.at(-1)).toBe(original);
  });
  it.each(['bigint unsigned', 'decimal(30,10)', 'datetime(6)', 'date', 'blob', 'varbinary(10)', 'binary(4)', 'bit(8)'])('非文本类型 %s 保留原生空值安全比较，不发生字符集转换', type => {
    const info = { ...table, columns: [table.columns[0], { ...table.columns[1], type }] };
    const result = buildChanges(info, [{ kind: 'delete', before: { id: '1', title: null } }]);
    expect(result.statements[0].sql).toContain('AND `title` <=> ?');
    expect(result.statements[0].sql).not.toContain('CONVERT');
    expect(result.statements[0].params.at(-1)).toBeNull();
  });
});

describe('结构设计', () => {
  it('创建字段、索引与跨库外键，注释正确转义', () => {
    const result = buildDesign({ ...design, foreignKeys: [{ name: 'fk_id', columns: ['id'], referencedDatabase: 'other', referencedTable: 'ids', referencedColumns: ['id'], onDelete: 'RESTRICT', onUpdate: 'CASCADE' }] });
    expect(result.sql).toContain('PRIMARY KEY (`id`)'); expect(result.sql).toContain("COMMENT '客户的''名称'");
    expect(result.sql).toContain('REFERENCES `other`.`ids` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE');
  });
  it('修改时生成一次 ALTER，避免自动增长列的索引在中间状态丢失', () => {
    const result = buildDesign({ ...design, originalName: 'items', name: 'items_new', columns: [{ ...design.columns[0] }, { ...design.columns[1], originalName: 'title', name: 'name' }] }, table);
    expect(result.statements).toHaveLength(1); expect(result.sql).not.toContain('DROP PRIMARY KEY');
    expect(result.sql).toContain('CHANGE COLUMN `title` `name`'); expect(result.sql).toContain('RENAME TO `测试库`.`items_new`');
    expect(result.warnings.join('')).toContain('不能');
  });
  it('仅改普通字段时保留未变索引和外键，避免同ALTER重建同名FK', () => {
    const key = { name: 'fk_id', columns: ['id'], referencedDatabase: 'other', referencedTable: 'ids', referencedColumns: ['id'], onDelete: 'RESTRICT', onUpdate: 'CASCADE' };
    const result = buildDesign({ ...design, foreignKeys: [key] }, { ...table, foreignKeys: [key] });
    expect(result.statements).toHaveLength(1); expect(result.sql).not.toContain('DROP FOREIGN KEY');
    expect(result.sql).not.toContain('ADD CONSTRAINT'); expect(result.sql).not.toContain('DROP PRIMARY KEY');
  });
  it('同名外键动作改变时先单独删除，并明确非原子执行边界', () => {
    const key = { name: 'fk_id', columns: ['id'], referencedDatabase: 'other', referencedTable: 'ids', referencedColumns: ['id'], onDelete: 'RESTRICT', onUpdate: 'CASCADE' };
    const result = buildDesign({ ...design, foreignKeys: [{ ...key, onDelete: 'CASCADE' }] }, { ...table, foreignKeys: [key] });
    expect(result.statements).toHaveLength(2); expect(result.statements[0].sql).toBe('ALTER TABLE `测试库`.`items`\n  DROP FOREIGN KEY `fk_id`');
    expect(result.statements[1].sql).toContain('ADD CONSTRAINT `fk_id`'); expect(result.statements[1].sql).not.toContain('DROP FOREIGN KEY');
    expect(result.warnings.join('')).toContain('旧外键已删除');
  });
  it('索引列改名保留服务器维护的索引，删除索引只删除指定项', () => {
    const extra = { name: 'ix_title', unique: false, columns: ['title'] };
    const result = buildDesign({ ...design, columns: [design.columns[0], { ...design.columns[1], originalName: 'title', name: 'renamed' }], indexes: [...design.indexes, { ...extra, columns: ['renamed'] }] }, { ...table, indexes: [...table.indexes, extra] });
    expect(result.sql).not.toContain('DROP INDEX'); expect(result.sql).not.toContain('ADD KEY');
    expect(buildDesign(design, { ...table, indexes: [...table.indexes, extra] }).sql).toContain('DROP INDEX `ix_title`');
  });
  it('拒绝缺失字段索引及危险的外键动作', () => {
    expect(() => buildDesign({ ...design, indexes: [{ name: 'x', unique: false, columns: ['unknown'] }] })).toThrow('不存在');
    expect(() => buildDesign({ ...design, foreignKeys: [{ name: 'x', columns: ['id'], referencedDatabase: 'a', referencedTable: 'b', referencedColumns: ['id'], onUpdate: 'CASCADE; DROP DATABASE x', onDelete: 'RESTRICT' }] })).toThrow('动作');
  });
  it('原表字符集未改动时保留排序规则与表注释，避免降级到字符集默认规则', () => {
    const original = { ...table, charset: 'utf8mb4', collation: 'utf8mb4_bin', comment: '业务说明' };
    const result = buildDesign({ ...design, originalName: 'items', comment: original.comment }, original);
    expect(result.sql).toContain("DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='业务说明'");
    expect(buildDesign({ ...design, charset: 'latin1' }, original).sql).not.toContain('COLLATE=utf8mb4_bin');
  });
  it('MariaDB 文字量默认值只解码一次，并区分 NULL 与文字 NULL', () => {
    expect(mariaDefault("'ABC'")).toBe('ABC'); expect(mariaDefault("'concat(''A'',''B'')'")).toBe("concat('A','B')");
    expect(mariaDefault('NULL')).toBeNull(); expect(mariaDefault("'NULL'")).toBe('NULL');
    expect(mariaDefault("'a\\nb'")).toBe('a\nb'); expect(mariaDefault("'a\\nb'", true)).toBe('a\\nb');
    const result = buildDesign({ ...design, columns: [{ ...design.columns[1], defaultValue: 'CURRENT_TIMESTAMP()' }], indexes: [] });
    expect(result.sql).toContain("DEFAULT 'CURRENT_TIMESTAMP()'");
  });
});
