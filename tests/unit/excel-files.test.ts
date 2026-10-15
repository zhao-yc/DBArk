import { afterEach, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { mkdir, mkdtemp, readdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { exportExcelFile, listExcelSheets, previewExcelSheet, readExcelRows } from '../../src/engine/excelFiles';
import { encodeExcelCell, decodeExcelText, validateExcelText } from '../../src/engine/excelCellPolicy';
import type { CellValue } from '../../src/shared/contracts';

const folders: string[] = [];
/** 只清理本用例创建的目录内文件，不执行递归删除。 */
afterEach(async () => { for (const folder of folders.splice(0)) { for (const file of await readdir(folder)) await rm(join(folder, file)); await rmdir(folder); } });
async function target(): Promise<string> { const base = join(process.cwd(), '.cache/f02-excel/tmp'); await mkdir(base, { recursive: true }); const folder = await mkdtemp(join(base, 'test-')); folders.push(folder); return join(folder, 'table.xlsx'); }
async function* values(rows: CellValue[][]): AsyncGenerator<CellValue[]> { yield* rows; }

describe('Excel 单元格保真策略', () => {
  it('表头可选择实际行号，跳过说明行且保留后续值；空缺行不能悄悄改用下一行', async () => {
    const path = await target(), workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet('数据');
    sheet.addRow(['说明']); sheet.addRow(['编号', '名称']); sheet.addRow(['9007199254740993', '中文']); await workbook.xlsx.writeFile(path);
    const sample = await previewExcelSheet({ filePath: path, sheetId: '1', headerRow: 2, protocol: 'plain' });
    expect(sample.columns).toEqual(['编号', '名称']); expect(sample.rows).toEqual([{ 编号: '9007199254740993', 名称: '中文' }]);
    const rows = []; for await (const row of readExcelRows({ filePath: path, sheetId: '1', headerRow: 2, protocol: 'plain' })) rows.push(row);
    expect(rows).toEqual(sample.rows);
    await expect(previewExcelSheet({ filePath: path, sheetId: '1', headerRow: 0, protocol: 'plain' })).rejects.toThrow('表头行号');
  });
  it('NULL、空串、反斜线、二进制和公式外观文字可逆', () => {
    for (const value of [null, '', '\\N', '\\B:AA==', '\\path', '=SUM(A1)', { type: 'binary' as const, base64: 'AAH/' }]) {
      const encoded = encodeExcelCell(value, { name: '值', type: 'text' });
      expect(decodeExcelText(String(encoded), 'dbark-v1')).toEqual(value);
    }
    expect(decodeExcelText('\\N', 'plain')).toBe('\\N');
  });
  it('精确数字拒绝浮点输入，浮点写为可往返文本', () => {
    expect(() => encodeExcelCell(1, { name: '金额', type: 'decimal(20,6)' })).toThrow('原始文本');
    expect(encodeExcelCell('18446744073709551615', { name: '编号', type: 'bigint' })).toBe('18446744073709551615');
    expect(encodeExcelCell(0.12345678901234568, { name: '浮点', type: 'double' })).toBe('0.12345678901234568');
    expect(encodeExcelCell(1e20, { name: '值', type: 'double' })).toBe('100000000000000000000');
    expect(encodeExcelCell(-0, { name: '值', type: 'double' })).toBe('-0');
    expect(() => encodeExcelCell(Number.MAX_SAFE_INTEGER + 1, { name: '值', type: 'unknown' })).toThrow('精度');
  });
  it('超长、孤立代理项和XML无效字符被拒绝', () => {
    expect(() => validateExcelText('x'.repeat(32768))).toThrow('32767');
    expect(() => validateExcelText('\ud800')).toThrow('无法无损');
    expect(() => validateExcelText('\u0000')).toThrow('无法无损');
    expect(validateExcelText('中文😀\r\n')).toBe('中文😀\r\n');
  });
});

describe('真实 XLSX 引擎', () => {
  it('导出可由ExcelJS读取，精度、文本公式与协议完整往返', async () => {
    const path = await target();
    const source: CellValue[][] = [['18446744073709551615', '0.12345678901234567890', '2026-10-15 12:34:56.123456', '=1+1', null, '', { type: 'binary', base64: 'AAH/' }, '\\N']];
    const columns = ['__proto__', '小数', '时间', '公式文字', '空值', '空串', '字节', '标记'].map(name => ({ name, type: 'text' }));
    expect((await exportExcelFile({ filePath: path, columns, rows: values(source), onCommitStart() {} })).rows).toBe(1);
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.readFile(path);
    expect(workbook.worksheets[0].getCell('D2').type).not.toBe(ExcelJS.ValueType.Formula);
    expect(workbook.worksheets[0].getCell('A2').text).toBe(source[0][0]);
    const sheets = await listExcelSheets({ filePath: path }); expect(sheets).toEqual([{ id: '1', name: '数据', hidden: false }]);
    const preview = await previewExcelSheet({ filePath: path, sheetId: '1', protocol: 'dbark-v1' });
    expect(preview.columns).toEqual(columns.map(column => column.name));
    expect(Object.values(preview.rows[0])).toEqual(source[0]); expect(Object.getPrototypeOf(preview.rows[0])).toBe(null);
    const rows = []; for await (const row of readExcelRows({ filePath: path, sheetId: '1', protocol: 'dbark-v1' })) rows.push(row);
    expect(Object.values(rows[0])).toEqual(source[0]);
  });
  it('OOXML字面转义、回车换行、DEL和空白在官方库与自身读取中都保留', async () => {
    const path = await target(), originals = ['_x0041_', '_x005F_', 'a\r\nb\rc\n\t', '\u007f', '  中文😀  ', '&amp;'];
    await exportExcelFile({ filePath: path, columns: [{ name: '字段_x0041_', type: 'text' }], rows: values(originals.map(value => [value])), onCommitStart() {} });
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.readFile(path);
    expect(originals.map((_value, index) => workbook.worksheets[0].getCell(index + 2, 1).text)).toEqual(originals);
    const rows = []; for await (const row of readExcelRows({ filePath: path, sheetId: '1', protocol: 'dbark-v1' })) rows.push(row['字段_x0041_']);
    expect(rows).toEqual(originals);
  });
  it('支持工作表选择、共享字符串和20行预览', async () => {
    const path = await target(), workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('第一张').addRow(['其它']);
    const selected = workbook.addWorksheet('选择此表', { state: 'hidden' }); selected.addRow(['字段']);
    for (let index = 0; index < 30; index++) selected.addRow([`数据${index}`]);
    await workbook.xlsx.writeFile(path, { useSharedStrings: true });
    expect(await listExcelSheets({ filePath: path })).toHaveLength(2);
    const preview = await previewExcelSheet({ filePath: path, sheetId: '2', protocol: 'plain' });
    expect(preview.rows).toHaveLength(20); expect(preview.rows[0]['字段']).toBe('数据0');
  });
  it('拒绝公式、外部超链接、合并与重复标题', async () => {
    for (const mode of ['formula', 'link', 'merge', 'duplicate']) {
      const path = await target(), workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet('数据');
      sheet.addRow(mode === 'duplicate' ? ['x', 'x'] : ['x', 'y']);
      sheet.addRow(['值', '']);
      if (mode === 'formula') sheet.getCell('A2').value = { formula: '1+1', result: 2 };
      if (mode === 'link') sheet.getCell('A2').value = { text: '外部', hyperlink: 'https://example.com' };
      if (mode === 'merge') sheet.mergeCells('A2:B2');
      await workbook.xlsx.writeFile(path);
      await expect(previewExcelSheet({ filePath: path, sheetId: '1', protocol: 'plain' })).rejects.toThrow(mode === 'formula' ? '公式' : mode === 'link' ? '外部链接' : mode === 'merge' ? '合并' : '重复');
    }
  });
  it('导出取消保留原文件并清理独占临时文件', async () => {
    const path = await target(); await writeFile(path, '原内容'); let cancelled = false;
    async function* rows() { yield ['第一行']; cancelled = true; yield ['第二行']; }
    await expect(exportExcelFile({ filePath: path, columns: [{ name: '字段', type: 'text' }], rows: rows(), checkCancelled() { if (cancelled) throw new Error('已取消'); }, onCommitStart() {} })).rejects.toThrow('已取消');
    expect(await readFile(path, 'utf8')).toBe('原内容'); expect(await readdir(folders.at(-1)!)).toEqual(['table.xlsx']);
  });
  it('预览后文件改写会在第一行导入前被指纹拒绝', async () => {
    const path = await target(), columns = [{ name: '值', type: 'text' }];
    await exportExcelFile({ filePath: path, columns, rows: values([['预览值']]), onCommitStart() {} });
    const preview = await previewExcelSheet({ filePath: path, sheetId: '1', protocol: 'plain' });
    await exportExcelFile({ filePath: path, columns, rows: values([['修改值']]), onCommitStart() {} });
    const reader = readExcelRows({ filePath: path, sheetId: '1', protocol: 'plain', expectedFingerprint: preview.fingerprint });
    await expect(reader.next()).rejects.toThrow('自预览后已发生变化');
  });
  it('20行以后的公式也必须在预览阶段拒绝', async () => {
    const path = await target(), workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet('数据');
    sheet.addRow(['标题']); for (let index = 0; index < 30; index++) sheet.addRow(['普通文本']);
    sheet.getCell('A30').value = { formula: '1+1', result: 2 }; await workbook.xlsx.writeFile(path);
    await expect(previewExcelSheet({ filePath: path, sheetId: '1', protocol: 'plain' })).rejects.toThrow('公式');
  });
});
