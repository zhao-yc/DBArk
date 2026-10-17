import { describe, expect, it } from 'vitest';
import { tableCopyStructureCounterDefinition, tableCopyStructureObservedCounter } from '../../src/engine/tableCopyStructureCounter';
import { validateCommand } from '../../src/shared/validation';
const mode = { dialect: 'mysql' as const, mode: { noBackslashEscapes: false, ansiQuotes: false } };
const source = "CREATE TABLE `source` (`id` bigint unsigned NOT NULL AUTO_INCREMENT,`s` varchar(80) DEFAULT 'AUTO_INCREMENT=99' COMMENT 'AUTO_INCREMENT=88',PRIMARY KEY (`id`),KEY `idx` (`s`)) ENGINE=InnoDB AUTO_INCREMENT=9007199254740993 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='AUTO_INCREMENT=77'";
describe('复制结构自增准备：只读定义比较与准确计数字符串，不证明服务器继承语义', () => {
  it('只剔除真实顶层数值选项；列AUTO_INCREMENT、默认值、注释、索引和物理选项逐字保留', () => {
    const parsed = tableCopyStructureCounterDefinition(source, mode);
    expect(parsed.declaredValue).toBe('9007199254740993'); expect(parsed.column).toEqual({ name: 'id', type: 'bigint unsigned', maximum: '18446744073709551615' });
    expect(parsed.sourceWithoutCounter).toBe(source.replace(' AUTO_INCREMENT=9007199254740993', ''));
    expect(parsed.comparison).toBe(tableCopyStructureCounterDefinition(source.replace('9007199254740993', '9007199254740994'), mode).comparison);
    const renamed = source.replace('CREATE TABLE `source`', 'CREATE TABLE `destination`'); expect(parsed.comparison).toBe(tableCopyStructureCounterDefinition(renamed, mode).comparison);
    for (const changed of [source.replace('AUTO_INCREMENT,', ','), source.replace('bigint unsigned', 'bigint'), source.replace("DEFAULT 'AUTO_INCREMENT=99'", "DEFAULT 'AUTO_INCREMENT=98'"), source.replace('AUTO_INCREMENT=88', 'AUTO_INCREMENT=89'), source.replace('AUTO_INCREMENT=77', 'AUTO_INCREMENT=78'), source.replace('KEY `idx`', 'KEY `other`'), source.replace('utf8mb4_bin', 'utf8mb4_0900_ai_ci'), source.replace('ENGINE=InnoDB', 'ENGINE=Other'), source.replace('DEFAULT CHARSET', 'DEFAULT  CHARSET')]) {
      // 不把真正的列/表变化当作数据计数；不合法的变化直接拒绝也符合边界。
      let comparison: string | undefined; try { comparison = tableCopyStructureCounterDefinition(changed, mode).comparison; } catch { /* 无法证明的变化拒绝，不进入相等结果。 */ }
      expect(comparison).not.toBe(parsed.comparison);
    }
  });
  it.each(['01', '0', '+2', '1e3', "'2'", '18446744073709551616', '2+3'])('顶层计数%s未知或越界拒绝，不靠正则全局替换', value => expect(() => tableCopyStructureCounterDefinition(source.replace('9007199254740993', value), mode)).toThrow());
  it.each([' AUTO_INCREMENT=2', ' PARTITION BY HASH(id) PARTITIONS 2', ' UNKNOWN_OPTION=2', ' /*!80000 AUTO_INCREMENT=2 */'])('重复/分区/未知/执行片段%s不忽略', tail => expect(() => tableCopyStructureCounterDefinition(source + tail, mode)).toThrow());
  it('不把未知DEFAULT前缀当成可移除的顶层计数属性', () => expect(() => tableCopyStructureCounterDefinition(source.replace(' AUTO_INCREMENT=9007199254740993', ' DEFAULT AUTO_INCREMENT=9007199254740993'), mode)).toThrow('范围'));
  it('准确计数大于2^53仍区分相邻值；目录与SHOW CREATE变化拒绝，不发送或猜最大行值', () => {
    const parsed = tableCopyStructureCounterDefinition(source, mode); expect(tableCopyStructureObservedCounter('9007199254740993', parsed)).toBe('9007199254740993'); expect(() => tableCopyStructureObservedCounter('9007199254740994', parsed)).toThrow('并发');
    for (const value of [9007199254740992, null, undefined, '', ' 1', '01', '1e3']) expect(() => tableCopyStructureObservedCounter(value, parsed)).toThrow();
  });
  it('表尾省略不推断1，实际观测必须另读；无自增列只接受null', () => {
    const parsed = tableCopyStructureCounterDefinition(source.replace(' AUTO_INCREMENT=9007199254740993', ''), mode); expect(parsed.declaredValue).toBeUndefined(); expect(() => tableCopyStructureObservedCounter(undefined, parsed)).toThrow(); expect(() => tableCopyStructureObservedCounter(null, parsed)).toThrow(); expect(tableCopyStructureObservedCounter('7', parsed)).toBe('7');
    const plain = tableCopyStructureCounterDefinition('CREATE TABLE `plain` (`id` int NOT NULL) ENGINE=InnoDB', mode); expect(plain.column).toBeUndefined(); expect(tableCopyStructureObservedCounter(null, plain)).toBeNull(); expect(() => tableCopyStructureObservedCounter('1', plain)).toThrow();
  });
  it('中文与补充字符的原文偏移不影响顶层范围；仅分离计数，不规范其它字符', () => {
    const unicode = source.replace('AUTO_INCREMENT=88', '中文😀 AUTO_INCREMENT=88'), parsed = tableCopyStructureCounterDefinition(unicode, mode);
    expect(parsed.sourceWithoutCounter).toBe(unicode.replace(' AUTO_INCREMENT=9007199254740993', '')); expect(parsed.comparison).toContain('中文😀 AUTO_INCREMENT=88');
  });
  it('生成、隐藏、多个自增列或非整数不纳入准备支持范围', () => {
    for (const changed of [source.replace('bigint unsigned', 'decimal(20,0)'), source.replace('NOT NULL AUTO_INCREMENT', 'NOT NULL AUTO_INCREMENT INVISIBLE'), source.replace('NOT NULL AUTO_INCREMENT', 'NOT NULL AUTO_INCREMENT GENERATED ALWAYS AS (1) STORED'), source.replace('varchar(80)', 'int NOT NULL AUTO_INCREMENT')]) expect(() => tableCopyStructureCounterDefinition(changed, mode)).toThrow();
  });
  it('协议不接受客户端注入预期/实测计数或SQL；准备类型不开放执行能力', () => {
    for (const extra of [{ expectedNewValue: '1' }, { autoIncrement: { sourceValue: '7', expectedNewValue: '1' } }, { sql: 'ALTER TABLE x AUTO_INCREMENT=7' }]) expect(() => validateCommand('schema.tableCopyStructure.preview', { snapshotId: 's', newName: 'destination', taskId: 'p', ...extra })).toThrow();
  });
});
