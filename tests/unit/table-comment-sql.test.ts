import { describe, expect, it } from 'vitest';
import { validateCommand } from '../../src/shared/validation';
import { validateTableComment } from '../../src/shared/tableComment';
import { planTableComment, readTableCommentDefinition } from '../../src/engine/tableCommentSql';
import { parseTableColumnDefinition } from '../../src/engine/tableColumnDefinition';

const budget = { characters: 2048, utf8Bytes: 2048, supplementary: true, metadataCharset: 'utf8mb4' };
const context = { dialect: 'mysql' as const, mode: { noBackslashEscapes: false, ansiQuotes: false } };
const source = "CREATE TABLE `t` (`id` bigint NOT NULL AUTO_INCREMENT,`s` varchar(80) CHARACTER SET latin1 COLLATE latin1_bin DEFAULT 'COMMENT=伪属性',`g` int GENERATED ALWAYS AS (length(`s`)) STORED,PRIMARY KEY (`id`),KEY `prefix` (`s`(8)),CONSTRAINT `check` CHECK (`id`>0)) ENGINE=InnoDB AUTO_INCREMENT=9007199254740993 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC COMMENT='旧说明'";
describe('表注释单属性SQL与完整定义保真', () => {
  it.each([false, true])('引号、反斜杠和换行按NO_BACKSLASH_ESCAPES=%s往返，只生成COMMENT', noBackslashEscapes => {
    const mode = { ...context, mode: { ...context.mode, noBackslashEscapes } }, value = "客户'说明\\路径\r\n第二行; DROP TABLE x; -- 文本";
    const plan = planTableComment('db', 't', '旧说明', value, mode, budget);
    expect(plan.sql).toMatch(/^ALTER TABLE `db`\.`t` COMMENT = '/);
    const after = source.replace("COMMENT='旧说明'", plan.sql.slice(plan.sql.indexOf('COMMENT = '), -1));
    expect(readTableCommentDefinition(after, mode).comment).toBe(value);
    expect(readTableCommentDefinition(after, mode).preserved).toBe(readTableCommentDefinition(source, mode).preserved);
    expect(parseTableColumnDefinition(after, mode).columns).toHaveLength(3);
  });
  it('清空删除顶层COMMENT值，不删列注释或字面量中的假属性', () => {
    const before = readTableCommentDefinition(source, context), after = readTableCommentDefinition(source.replace("COMMENT='旧说明'", ''), context);
    expect(before.comment).toBe('旧说明'); expect(after.comment).toBe(''); expect(before.preserved).toBe(after.preserved);
    expect(planTableComment('db', 't', '旧说明', '', context, budget).sql).toBe("ALTER TABLE `db`.`t` COMMENT = '';");
    expect(() => planTableComment('db', 't', '', '', context, budget)).toThrow('没有实际');
  });
  it('未知表尾、重复COMMENT、可执行表选项和引擎指令明确只读', () => {
    for (const tail of [" COMMENT='重复'", ' PARTITION BY HASH(id) PARTITIONS 2', " /*!50100 COMMENT='隐藏' */"]) expect(readTableCommentDefinition(source + tail, context).reasons.length).toBeGreaterThan(0);
    expect(readTableCommentDefinition(source.replace('旧说明', 'MERGE_THRESHOLD=40'), context).reasons.join('')).toContain('引擎参数');
    for (const value of ['MERGE_THRESHOLD = 35', '说明 merge_threshold', 'NDB_TABLE=READ_BACKUP=0', 'server=远端']) expect(() => validateTableComment(value)).toThrow('引擎参数');
  });
  it('除顶层COMMENT之外任何列、索引或表选项变化都改变保留摘要', () => {
    const before = readTableCommentDefinition(source, context).preserved;
    for (const after of [source.replace('latin1_bin', 'latin1_general_ci'), source.replace('(`s`(8))', '(`s`(9))'), source.replace('DYNAMIC', 'COMPACT'), source.replace('9007199254740993', '9007199254740994'), source.replace('length(`s`)', 'length(`s`)+1')]) expect(readTableCommentDefinition(after, context).preserved).not.toBe(before);
  });
  it('字符与字节分开计算，拒绝非法Unicode、补充字符未知与超预算，不截断', () => {
    expect(validateTableComment('中'.repeat(682), budget)).toHaveLength(682);
    expect(() => validateTableComment('中'.repeat(683), budget)).toThrow('字节');
    expect(validateTableComment('😀', budget)).toBe('😀');
    expect(() => validateTableComment('😀', { ...budget, supplementary: false })).toThrow('补充平面');
    for (const value of ['\uD800', '\uDC00', '\0', 'a'.repeat(2049)]) expect(() => validateTableComment(value, budget)).toThrow();
  });
  it('公开契约拒绝SQL、改目标、伪造revision和不认识的确认项', () => {
    expect(validateCommand('schema.tableComment.preview', { snapshotId: 's', comment: '', taskId: 'task' })).toMatchObject({ comment: '' });
    for (const extra of [{ sql: 'ALTER TABLE x' }, { database: 'other' }, { connectionRevision: 9 }, { patches: [] }]) expect(() => validateCommand('schema.tableComment.preview', { snapshotId: 's', comment: '说明', taskId: 'task', ...extra })).toThrow();
    expect(() => validateCommand('schema.tableComment.apply', { previewToken: 'p', taskId: 'task', acknowledgements: ['__proto__'] })).toThrow();
  });
});
