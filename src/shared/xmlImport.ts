import { z } from 'zod';

export const recordImportFormats = ['csv', 'json', 'xml'] as const;
export type RecordImportFormat = typeof recordImportFormats[number];

// XML 1.0 第五版命名范围。导入和记录布局导出均使用无命名空间的字段名。
const nameStart = String.raw`A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\u{10000}-\u{EFFFF}`;
export const xmlRecordName = new RegExp(String.raw`^[${nameStart}][${nameStart}0-9.\u00B7\u0300-\u036F\u203F-\u2040-]*$`, 'u');

export const xmlImportOptionsSchema = z.object({
  rowTag: z.string().min(1).max(256).regex(xmlRecordName, '请输入有效的 XML 记录标签名'),
  attributes: z.boolean(),
  binaryBase64: z.boolean(),
  documentResult: z.number().int().min(1).max(200).optional(),
}).strict().refine(value => value.documentResult === undefined || !value.binaryBase64, 'XML 文档使用单元格自带的二进制类型');
export type XmlImportOptions = z.infer<typeof xmlImportOptionsSchema>;
// SQLite 的二进制解释由逐列映射决定。
export const sqliteXmlImportOptionsSchema = xmlImportOptionsSchema.safeExtend({ binaryBase64: z.literal(false) });
export type SqliteXmlImportOptions = z.infer<typeof sqliteXmlImportOptionsSchema>;

export const xmlImportZh = {
  invalid: '请核对 XML 记录标签或文档结果序号，编码固定为 UTF-8',
  atomic: 'XML 导入使用整文件事务',
  rowTag: 'XML 记录标签',
  attributes: '将记录属性作为字段',
  binary: '将映射到二进制列的字段按 Base64 解码',
  hint: '根元素下每个记录使用同一标签。子元素和启用的记录属性作为源字段。缺少已映射字段的记录使用 NULL，空元素或空属性保留空文本。',
  layout: 'XML 布局', flat: '记录标签／属性', document: 'XML 文档（按列位置）', result: '行结果序号',
  documentColumns: '所选结果字段', documentRecords: (count: number) => `所选行结果 ${count.toLocaleString('zh-CN')} 条记录`,
  documentHint: '按结果出现顺序从 1 开始，语句回执不占序号。按列位置读入，重名、空名或超长列名会加上位置标识。文件只包含导出时保存的行。',
  documentShape: 'XML 文档的版本、列位置、单元格类型或记录汇总不符合 tabrelio 导出约定',
  documentMissing: 'XML 文档没有所选的行结果，请核对结果序号',
  documentText: 'XML 文档含有无法写入数据库的孤立代理码元',
  syntax: 'XML 不是受支持的 UTF-8 XML 1.0 文档',
  shape: 'XML 须使用根元素、记录元素和简单字段元素，字段名不能重复',
  noRows: 'XML 文件没有指定标签的记录',
  unknownColumn: 'XML 文件缺少已映射的源字段，请重新选择文件并核对映射',
  limit: 'XML 文件、记录、字段或列数超过导入上限',
} as const;

export function validXmlImport(input: { format: string; encoding: string; xmlOptions?: unknown }): boolean {
  return input.format === 'xml' ? input.encoding === 'utf8' && xmlImportOptionsSchema.safeParse(input.xmlOptions).success : !Object.hasOwn(input, 'xmlOptions');
}
