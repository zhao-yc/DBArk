import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { readTableCreateIndexFacts } from '../../src/engine/tableCreateIndexFacts';
import { fixture, prepared, apply } from '../fixtures/table-create-prefix-metadata';

/** 使用已安装mysql2的真实文本解析器，仅给包读取器合成LONGLONG值，不开连接。 */
function driverPage() {
  const require = createRequire(import.meta.url);
  const parser = require(require.resolve('mysql2').replace(/index\.js$/, 'lib/parsers/static_text_parser.js'));
  const fields = [{ name: 'pageSize', columnType: 8, characterSet: 63, encoding: 'binary' }];
  return parser(fields, {}, { supportBigNumbers: true, bigNumberStrings: true }).next({ parseLengthCodedIntString: () => '16384' }, fields, {}).pageSize;
}
describe('新表前缀独立评审元数据补核（RAM）', () => {
  it('真实mysql2返回规范页大小字符串时，完整任务链仍能准备并后核', async () => {
    const f = fixture(); f.state.page = driverPage(); expect(f.state.page).toBe('16384');
    const value = await prepared(f); expect((await apply(f, value.preview)).definitionVerified).toBe(true);
  });
  it('SHOW省略latin1默认COLLATE时，以准确目录补证而非误拒', async () => {
    const f = fixture('latin1', false), value = await prepared(f);
    expect((await apply(f, value.preview)).definitionVerified).toBe(true);
  });
  it('非键BLOB两项目录长度同时缩小仍须拒绝完整核验', async () => {
    const f = fixture('utf8mb4', true, 'blob'), value = await prepared(f);
    f.state.auxiliaryPatch = { CHARACTER_MAXIMUM_LENGTH: 64, CHARACTER_OCTET_LENGTH: 64 };
    expect(await apply(f, value.preview)).toMatchObject({ ddlCompleted: true, definitionVerified: false });
  });
  it.each(['016384', ' 16384', '16384 ', '+16384', '16384.0', '1.6384e4', '16384x', '9007199254740993', '', null, {}, 16384.5])('非规范页大小%j在DDL前拒绝', async page => {
    const f = fixture(); f.state.page = page; await expect(readTableCreateIndexFacts(f.context)).rejects.toThrow(); expect(f.state.created).toBe(false);
  });
  it.each([[], [{ name: 'latin1', collation: 'latin1_bin', maxBytes: 1 }], [{ name: 'utf8mb4', collation: 'latin1_swedish_ci', maxBytes: 1 }], [{ name: 'latin1', collation: 'latin1_swedish_ci', maxBytes: 4 }], [{ name: 'latin1', maxBytes: 1 }], [{ name: 'latin1', collation: 'latin1_swedish_ci', maxBytes: 1 }, { name: 'latin1', collation: 'latin1_swedish_ci', maxBytes: 1 }]].map(catalog => ({ catalog })))('缺失或矛盾默认目录%j只能保留ACK', async ({ catalog }) => {
    const f = fixture('latin1', false), value = await prepared(f); f.state.defaultCatalog = catalog;
    expect(await apply(f, value.preview)).toMatchObject({ ddlCompleted: true, definitionVerified: false });
  });
  it.each([['tinyblob',255],['blob',65535],['mediumblob',16777215],['longblob',4294967295]] as const)('非键%s严格证明子类型容量，包括驱动整数字符串', async (type, capacity) => {
    for (const valid of [true, false]) {
      const f = fixture('utf8mb4', true, type), value = await prepared(f);
      f.state.auxiliaryPatch = { CHARACTER_MAXIMUM_LENGTH: String(valid ? capacity : 64), CHARACTER_OCTET_LENGTH: String(valid ? capacity : 64) };
      expect((await apply(f, value.preview)).definitionVerified).toBe(valid);
    }
  });
});
