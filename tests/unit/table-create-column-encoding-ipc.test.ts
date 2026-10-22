import { describe, expect, it } from 'vitest';
import { validateCommand } from '../../src/shared/validation';
import { tableCreateAcknowledgements, tableCreateLegacyDesign } from '../../src/shared/tableCreate';

/** IPC只能传明确列配对；真实目录存在性与摘要仍由引擎令牌证明。 */
function draft(column: Record<string, unknown> = {}) {
  return { database: 'db', name: '新表', engine: 'InnoDB', charset: 'utf8mb4', comment: '',
    columns: [{ name: '令牌', type: 'VARCHAR(80)', nullable: true, autoIncrement: false, comment: '', ...column }], indexes: [], foreignKeys: [] };
}
const pair = { charset: 'utf8mb4', collation: 'utf8mb4_bin' };
/** 统一走真正的命令解析，避免只验证未被IPC引用的辅助schema。 */
function preview(design: ReturnType<typeof draft>) { return validateCommand('schema.tableCreate.preview', { snapshotId: 'read', taskId: 'preview', design }); }

describe('新建表字段编码的IPC入口', () => {
  it('省略列配对继续继承，明确字段配对保留原值与表级独立选择', () => {
    const inherited = draft(); expect(preview(inherited)).toEqual({ snapshotId: 'read', taskId: 'preview', design: inherited });
    const explicit = { ...draft({ collation: pair }), collation: 'utf8mb4_general_ci' };
    expect(preview(explicit)).toEqual({ snapshotId: 'read', taskId: 'preview', design: explicit });
  });

  it.each(['CHAR(3)', 'VARCHAR(800)', 'TINYTEXT', 'TEXT', 'MEDIUMTEXT', 'LONGTEXT', "ENUM('甲','COLLATE')", "SET('a','b')"])('字符类型可携带完整配对：%s', type => {
    expect(preview(draft({ type, collation: pair }))).toBeTruthy();
  });

  it('IPC不猜目录存在性或别名，保留候选词法与255字符排序规则预算', () => {
    const collation = 'c'.repeat(255), design = draft({ collation: { charset: 'A'.repeat(64), collation } });
    expect(preview(design)).toEqual({ snapshotId: 'read', taskId: 'preview', design });
  });

  it.each([
    undefined, null, {}, [], 'utf8mb4_bin', { charset: 'utf8mb4' }, { collation: 'utf8mb4_bin' },
    { ...pair, extra: true }, { ...pair, charset: '' }, { ...pair, collation: '' },
    { ...pair, charset: 'x'.repeat(65) }, { ...pair, collation: 'x'.repeat(256) },
    { ...pair, charset: 'utf8mb4;DROP' }, { ...pair, collation: 'utf8mb4_bin COMMENT' },
    { ...pair, collation: '`utf8mb4_bin`' }, { ...pair, collation: 'utf8mb4_bin\u0000' },
  ].map(collation => ({ collation })))('拒绝显式空值、额外属性和SQL片段：%j', ({ collation }) => {
    expect(() => preview(draft({ collation }))).toThrow();
  });

  it.each(['INT', 'BIGINT UNSIGNED', 'DECIMAL(20,6)', 'FLOAT', 'BIT(1)', 'DATETIME(6)', 'BINARY(20)', 'VARBINARY(20)', 'BLOB', 'JSON', 'GEOMETRY'])('非普通字符字段不能声明列编码：%s', type => {
    expect(() => preview(draft({ type, collation: pair }))).toThrow();
  });

  it('生成字段不能借普通列配对绕过专用属性门', () => {
    expect(() => preview(draft({ type: 'INT', generated: { storage: 'VIRTUAL', expression: '1 + 2' }, collation: pair }))).toThrow();
  });

  it('拒绝调用方伪造目录、摘要或只读列回执', () => {
    for (const column of [{ collation: pair, catalogDigest: 'fake' }, { collation: { ...pair, catalogDigest: 'fake' } }]) expect(() => preview(draft(column))).toThrow();
    expect(() => preview({ ...draft({ collation: pair }), columnEncodings: { catalogDigest: 'fake', selections: [] } } as ReturnType<typeof draft>)).toThrow();
    expect(() => validateCommand('schema.tableCreate.get', { connectionId: 'c', database: 'db', taskId: 'get', encodings: { candidates: [pair] } })).toThrow();
  });

  it('通用schema.preview和旧新表转换器拒绝显式列配对，不能静默丢弃', () => {
    const design = draft({ collation: pair });
    expect(() => validateCommand('schema.preview', { connectionId: 'c', design })).toThrow();
    expect(() => tableCreateLegacyDesign(design as Parameters<typeof tableCreateLegacyDesign>[0])).toThrow();
  });

  it('列编码不添加另一种风险豁免，普通CREATE仍使用原两项确认', () => {
    const value = { previewToken: 'token', confirmation: 'db.新表', acknowledgements: [...tableCreateAcknowledgements], taskId: 'apply' };
    expect(validateCommand('schema.tableCreate.apply', value)).toEqual(value);
    expect(() => validateCommand('schema.tableCreate.apply', { ...value, acknowledgements: [...tableCreateAcknowledgements, 'column-encoding-approved'] })).toThrow();
  });
});
