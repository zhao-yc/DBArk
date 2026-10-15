import { afterEach, describe, expect, it } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { mkdir, mkdtemp, readdir, rm, rmdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { excelCrc32, ExcelZipArchive } from '../../src/engine/excelZipBudget';
import { previewExcelSheet, readExcelRows } from '../../src/engine/excelFiles';
import { excelXmlEvents } from '../../src/engine/excelXmlReader';

const folders: string[] = [];
afterEach(async () => { for (const folder of folders.splice(0)) { for (const file of await readdir(folder)) await rm(join(folder, file)); await rmdir(folder); } });

/** 小型 ZIP32 测试夹具可故意改变声明大小和 CRC，不依赖被测 ZIP 读取器生成元数据。 */
function zipData(files: { name: string; text: string; claimedSize?: number; badCrc?: boolean; method?: number; flags?: number }[]): Buffer {
  const local: Buffer[] = [], central: Buffer[] = []; let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name), plain = Buffer.from(file.text), method = file.method ?? 8, bytes = method === 8 ? deflateRawSync(plain) : plain;
    const crc = file.badCrc ? 0 : (excelCrc32(plain) ^ 0xffffffff) >>> 0, expanded = file.claimedSize ?? plain.length;
    const head = Buffer.alloc(30); head.writeUInt32LE(0x04034b50); head.writeUInt16LE(20, 4); head.writeUInt16LE(file.flags ?? 0x800, 6); head.writeUInt16LE(method, 8); head.writeUInt32LE(crc, 14); head.writeUInt32LE(bytes.length, 18); head.writeUInt32LE(expanded, 22); head.writeUInt16LE(name.length, 26);
    const directory = Buffer.alloc(46); directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(file.flags ?? 0x800, 8); directory.writeUInt16LE(method, 10); directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(bytes.length, 20); directory.writeUInt32LE(expanded, 24); directory.writeUInt16LE(name.length, 28); directory.writeUInt32LE(offset, 42);
    local.push(head, name, bytes); central.push(directory, name); offset += head.length + name.length + bytes.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
async function fixture(data: Buffer): Promise<string> { const base = join(process.cwd(), '.cache/f02-excel/tmp'); await mkdir(base, { recursive: true }); const folder = await mkdtemp(join(base, 'zip-')); folders.push(folder); const path = join(folder, 'input.xlsx'); await writeFile(path, data); return path; }
function workbook(sheet: string): Buffer {
  return zipData([
    { name: 'xl/workbook.xml', text: '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="数据" sheetId="1" r:id="rId1"/></sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', text: '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>' },
    { name: 'xl/worksheets/sheet1.xml', text: `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>数字</t></is></c></row>${sheet}</sheetData></worksheet>` },
  ]);
}

describe('XLSX ZIP 真实展开预算', () => {
  it('校验标准 CRC32 和 stored/deflate 两种 entry', async () => {
    expect((excelCrc32(Buffer.from('123456789')) ^ 0xffffffff) >>> 0).toBe(0xcbf43926);
    for (const method of [0, 8]) { const path = await fixture(zipData([{ name: 'a.xml', text: '中文', method }])); const zip = await ExcelZipArchive.open(path); try { await zip.audit(); } finally { await zip.close(); } }
  });
  it('实际解压超出伪造目录大小时中止，CRC错误也拒绝', async () => {
    for (const file of [{ name: 'a.xml', text: 'x'.repeat(100_000), claimedSize: 10 }, { name: 'a.xml', text: 'hello', badCrc: true }]) {
      const path = await fixture(zipData([file])), zip = await ExcelZipArchive.open(path);
      try { await expect(zip.audit()).rejects.toThrow(file.badCrc ? 'CRC' : '实际展开'); } finally { await zip.close(); }
    }
  });
  it('拒绝目录穿越、重复entry、加密、ZIP64和不支持压缩', async () => {
    for (const files of [
      [{ name: '../a.xml', text: '' }], [{ name: 'a.xml', text: '' }, { name: 'a.xml', text: '' }],
      [{ name: 'a.xml', text: '', flags: 1 }], [{ name: 'a.xml', text: '', claimedSize: 0xffffffff }], [{ name: 'a.xml', text: '', method: 12 }],
    ]) await expect(ExcelZipArchive.open(await fixture(zipData(files)))).rejects.toThrow();
  });
  it('取消与提前结束迭代后句柄仍可显式关闭，文件可立即删除', async () => {
    const path = await fixture(zipData([{ name: 'a.xml', text: 'x'.repeat(100_000) }])); let cancelled = false;
    const zip = await ExcelZipArchive.open(path, () => { if (cancelled) throw new Error('已取消'); });
    for await (const _chunk of zip.read('a.xml')) break;
    cancelled = true; await expect(zip.audit()).rejects.toThrow('已取消'); await zip.close(); await rm(path);
  });
  it('同句柄源文件被原地修改后拒绝继续', async () => {
    const path = await fixture(zipData([{ name: 'a.xml', text: 'before' }])), zip = await ExcelZipArchive.open(path);
    try { await writeFile(path, zipData([{ name: 'a.xml', text: 'changed-length' }])); await expect(zip.audit()).rejects.toThrow('发生变化'); } finally { await zip.close(); }
  });
});

describe('XLSX XML 和单元格安全边界', () => {
  it('原始数字token包括20位整数和长小数不经过Number解析', async () => {
    const path = await fixture(workbook('<row r="2"><c r="A2"><v>18446744073709551615</v></c></row><row r="3"><c r="A3"><v>0.12345678901234567890</v></c></row>'));
    const rows = []; for await (const row of readExcelRows({ filePath: path, sheetId: '1', protocol: 'plain' })) rows.push(row);
    expect(rows.map(row => row['数字'])).toEqual(['18446744073709551615', '0.12345678901234567890']);
  });
  it('拒绝单个巨型属性、注释、CDATA、DTD和过深嵌套', async () => {
    for (const xml of [`<a x="${'x'.repeat(300_000)}"/>`, `<!--${'>'.repeat(300_000)}--><a/>`, `<a><![CDATA[${'x'.repeat(300_000)}]]></a>`, '<!DOCTYPE a [<!ENTITY x "扩展">]><a>&x;</a>', '<a>'.repeat(65) + '</a>'.repeat(65)]) {
      const path = await fixture(zipData([{ name: 'a.xml', text: xml }])), zip = await ExcelZipArchive.open(path);
      try { await expect((async () => { for await (const _event of excelXmlEvents(zip, 'a.xml')) {} })()).rejects.toThrow(/上限|DTD|嵌套/); } finally { await zip.close(); }
    }
  });
  it('拒绝超列坐标、重复单元格、重复v和不存在共享字符串', async () => {
    for (const sheet of [
      '<row r="2"><c r="XFE2"><v>1</v></c></row>', '<row r="2"><c r="A2"><v>1</v></c><c r="A2"><v>2</v></c></row>',
      '<row r="2"><c r="A2"><v>1</v><v>2</v></c></row>', '<row r="2"><c r="A2" t="s"><v>99</v></c></row>',
    ]) await expect(previewExcelSheet({ filePath: await fixture(workbook(sheet)), sheetId: '1', protocol: 'plain' })).rejects.toThrow(/上限|顺序|重复|索引/);
  });
});
