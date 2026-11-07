import { queryHtmlZh } from './queryHtml.zh-CN';
import { txtExportZh } from './txtExport';

export const dataXmlZh = {
  format: 'XML 文档',
  hint: '生成 UTF-8 XML，按列位置保留原列名，并区分 NULL、空文本和二进制。',
  streamHint: '按执行顺序将各组结果和语句回执写入同一文档。',
  utf8: 'XML 导出固定使用 UTF-8',
  field: 'XML 单个字段超过 8 MiB',
  row: 'XML 单行或列头超过 16 MiB',
  invalid: 'XML 导出单元格类型无效',
};

export const xmlRecordLayouts = ['xml-elements', 'xml-attributes'] as const;
export type XmlRecordLayout = typeof xmlRecordLayouts[number];
export const dataMarkupFormats = ['html', 'xml', ...xmlRecordLayouts] as const;
export const dataFileFormats = ['txt', ...dataMarkupFormats] as const;
export type DataFileFormat = typeof dataFileFormats[number];

const recordXmlHint = '列名须唯一且符合 XML 命名规则。NULL 省略，空文本保留，二进制使用 Base64。';
const recordXmlStreamHint = '仅写入指定行结果集。语句回执仍显示在工作台。';

export function isXmlRecordLayout(format: string): format is XmlRecordLayout {
  return format === 'xml-elements' || format === 'xml-attributes';
}

export function isXmlFormat(format: string): boolean {
  return format === 'xml' || isXmlRecordLayout(format);
}

/** 保存对话框使用通用扩展名，文件令牌仍绑定到具体布局。 */
export function dataExportExtension(format: string): string {
  return isXmlRecordLayout(format) ? 'xml' : format;
}

/** 标记格式均在文件内声明 UTF-8。 */
export function dataMarkupText(format: string) {
  if (format === 'html') return queryHtmlZh;
  if (format === 'xml') return dataXmlZh;
  if (isXmlRecordLayout(format)) return {
    ...dataXmlZh,
    format: format === 'xml-elements' ? 'XML（列名标签）' : 'XML（记录属性）',
    hint: recordXmlHint,
    streamHint: recordXmlStreamHint,
  };
  return undefined;
}

export function dataFileText(format: string) {
  return format === 'txt' ? txtExportZh : dataMarkupText(format);
}
