import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import iconv from 'iconv-lite';
import { csvCell, csvValue, previewFile, readRecords, readText } from '../../src/engine/files';

const temporaryFolders: string[] = [];
/** 测试只删除本用例创建的临时文件，不使用递归删除。 */
afterEach(async () => { for (const folder of temporaryFolders.splice(0)) { for (const name of await readdir(folder)) await rm(join(folder, name)); await rmdir(folder); } });
async function fixture(content: string, encoding = 'utf8'): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'dbark-engine-test-')); temporaryFolders.push(folder);
  const path = join(folder, 'input'); await writeFile(path, iconv.encode(content, encoding)); return path;
}
describe('流式导入', () => {
  it('CSV 的 NULL、空字符串和反斜线文字往返保持区分', async () => {
    const values = [null, '', '\\N', '\\path', '含逗号,换行\n和"引号'];
    const path = await fixture('value\r\n' + values.map(value => csvCell(value)).join('\r\n') + '\r\n');
    const actual = []; for await (const row of readRecords(path, 'csv', 'utf8')) actual.push(row.value);
    expect(actual).toEqual(values);
    expect(csvValue('')).toBe('');
  });
  it('JSON 原始数值不会经过 JavaScript 浮点数舍入', async () => {
    const path = await fixture('[{"big":18446744073709551615,"decimal":0.12345678901234567890,"binary":{"type":"binary","base64":"AAH/"},"nested":{"n":18446744073709551615,"s":"123"}}]');
    const rows = []; for await (const row of readRecords(path, 'json', 'utf8')) rows.push(row);
    expect(rows[0].big).toBe('18446744073709551615'); expect(rows[0].decimal).toBe('0.12345678901234567890');
    expect(rows[0].binary).toEqual({ type: 'binary', base64: 'AAH/' });
    expect(rows[0].nested).toBe('{"n":18446744073709551615,"s":"123"}');
  });
  it('支持 GB18030 预览并在 20 条后释放文件流', async () => {
    const path = await fixture('名称,值\r\n' + Array.from({ length: 100 }, (_, index) => `中文${index},${index}`).join('\r\n'), 'gb18030');
    const preview = await previewFile({ filePath: path, format: 'csv', encoding: 'gb18030' });
    expect(preview.columns).toEqual(['名称', '值']); expect(preview.rows).toHaveLength(20); expect(preview.rows[0]['名称']).toBe('中文0');
    expect((await readFile(path)).length).toBeGreaterThan(0);
  });
  it('SQL UTF-16LE 文本解码保留中文', async () => {
    const path = await fixture('\uFEFFSELECT "中文";', 'utf16le');
    let text = ''; for await (const chunk of readText(path, 'utf16le')) text += chunk;
    expect(text).toBe('SELECT "中文";');
  });
  it('CSV 与 JSON 保留原型属性同名字段而不改写对象原型', async () => {
    for (const [format, content] of [['csv', '__proto__,constructor\n原型字段,构造字段'], ['json', '[{"__proto__":"原型字段","constructor":"构造字段"}]']] as const) {
      const path = await fixture(content);
      const rows = []; for await (const row of readRecords(path, format, 'utf8')) rows.push(row);
      expect(Object.hasOwn(rows[0], '__proto__')).toBe(true);
      expect(rows[0]['__proto__']).toBe('原型字段'); expect(rows[0]['constructor']).toBe('构造字段');
    }
  });
});
